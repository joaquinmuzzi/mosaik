import { afterEach, describe, expect, it, vi } from "vitest";
import { listContents } from "../src/api/contents.ts";
import { removeCover, setManualCover } from "../src/api/covers.ts";
import { findPageCover, pageImages } from "../src/api/page-covers.ts";
import { findSteamCover } from "../src/api/steam.ts";
import { MAX_ATTEMPTS, type CoverFinderOptions, createCoverFinder } from "../src/cover-finder.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { type PublicGet, getPublic, isPublicAddress, publicLookup, refusal } from "../src/public-http.ts";
import { silentLogger } from "./helpers.ts";

const DASHBOARD = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const T = 1_794_326_400_000;
const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;

let db: Database;
afterEach(() => {
  db?.close();
  db = undefined as unknown as Database;
});

function setup() {
  db = openDatabase(":memory:");
  applyMigrations(db);
}

/** Pages by address; an image is whatever ends in .jpg. Anything else is a 404. */
function site(pages: Record<string, string | number>) {
  return vi.fn<PublicGet>(async (url) => {
    const page = pages[url];
    if (typeof page === "string") return { status: 200, url, body: new TextEncoder().encode(page) };
    if (typeof page === "number") return { status: page, url, body: new Uint8Array() };
    return /\.jpg/.test(url)
      ? { status: 200, url, body: JPEG }
      : { status: 404, url, body: new Uint8Array() };
  });
}

const og = (image: string) => `<html><head><meta property="og:image" content="${image}"></head></html>`;

function addContent(id: string, source: string, kind: string, title: string, url?: string, seconds = 60) {
  db.prepare("INSERT INTO contents (id, source, kind, title, meta) VALUES (?, ?, ?, ?, ?)").run(
    id,
    source,
    kind,
    title,
    JSON.stringify(url ? { url } : {}),
  );
  db.prepare(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds)
     VALUES (?, ?, ?, 'de', ?, ?, ?, ?)`,
  ).run(`s:${id}`, source, kind === "game" ? "game" : "video", id, T, T + 60_000, seconds);
}

const finder = (options: Partial<CoverFinderOptions>) =>
  createCoverFinder({
    db,
    dashboard: DASHBOARD,
    webCovers: true,
    steamCovers: true,
    intervalMs: 60_000,
    log: silentLogger,
    now: () => T,
    get: site({}),
    fetchImpl: async () => Response.json({ total: 0, items: [] }),
    ...options,
  });

const origin = (id: string) =>
  (db.prepare("SELECT origin FROM covers WHERE content_id = ?").get(id) as { origin: string } | undefined)
    ?.origin ?? null;

describe("the addresses that can be asked", () => {
  it("are public ones", () => {
    for (const address of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"])
      expect(isPublicAddress(address), address).toBe(true);
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.68.101",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fd12::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "not an address",
    ])
      expect(isPublicAddress(address), address).toBe(false);
  });

  it("are https, on the usual port, without credentials", () => {
    expect(refusal(new URL("https://example.com/a"))).toBeNull();
    for (const url of [
      "http://example.com/",
      "https://example.com:8443/",
      "https://user:pass@example.com/",
      "https://127.0.0.1/",
      // The URL parser turns these into 127.0.0.1
      "https://2130706433/",
      "https://0x7f.1/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
    ])
      expect(refusal(new URL(url)), url).not.toBeNull();
  });

  it("are checked when the connection is made, after the name is resolved", async () => {
    const lookup = (all: boolean) =>
      new Promise<Error | null>((resolve) => publicLookup("localhost", { all }, (error) => resolve(error)));
    expect((await lookup(true))?.message).toBe("localhost is not a public address");
    expect((await lookup(false))?.message).toBe("localhost is not a public address");
    await expect(getPublic("https://localhost/", { accept: "*/*", maxBytes: 10 })).rejects.toThrow(
      "not a public address",
    );
  });
});

describe("the images of a page", () => {
  it("come from its metadata, whatever the quotes and the order", () => {
    const html = `<meta content='/cover.jpg?a=1&amp;b=2' property='og:image'/>
      <meta name="twitter:image:src" content="https://cdn.example/t.jpg">
      <meta property="og:image:width" content="1280">`;
    expect(pageImages(html, "https://example.com/x/y")).toEqual([
      "https://example.com/cover.jpg?a=1&b=2",
      "https://cdn.example/t.jpg",
    ]);
  });

  it("come from its structured data, without the ones that say there is none yet", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"thumbnailUrl":
      ["https://v.example/_404/404_processing_320x180.png","https://v.example/thumb0.jpg"]}]}</script>
      <script type="application/ld+json">{not json</script>`;
    expect(pageImages(html, "https://example.com/v/1")).toEqual(["https://v.example/thumb0.jpg"]);
  });

  it("of an AniWorld episode include the cover of the series", () => {
    const html = `<div style="background-image: url(/public/img/cover/wide_800x300.jpg)"></div>
      <img src="data:image/png;base64,AA==" data-src="/public/img/cover/serie-cover_220x330.jpg">
      ${og("https://aniworld.to/public/img/facebook.jpg?v=2")}`;
    expect(pageImages(html, "https://aniworld.to/anime/stream/serie/staffel-1/episode-3")[0]).toBe(
      "https://aniworld.to/public/img/cover/serie-cover_220x330.jpg",
    );
  });
});

describe("the cover of a page", () => {
  it("is its image, unless it is the logo of the site", async () => {
    const get = site({
      "https://site.example/": og("https://cdn.example/logo.jpg?v=1"),
      "https://site.example/a": og("https://cdn.example/a.jpg"),
      "https://site.example/b": og("https://cdn.example/logo.jpg?v=2"),
    });
    const frontPages = new Map();
    expect(await findPageCover("https://site.example/a", get, frontPages)).toEqual(JPEG);
    expect(await findPageCover("https://site.example/b", get, frontPages)).toBeNull();
    // The front page is read once, and is not a content itself
    expect(get.mock.calls.filter(([url]) => url === "https://site.example/")).toHaveLength(1);
    expect(await findPageCover("https://site.example/", get)).toBeNull();
  });

  it("does not exist when the page is gone, has no image, or what it gives is not one", async () => {
    const get = site({
      "https://site.example/": "<html></html>",
      "https://site.example/none": "<html></html>",
      "https://site.example/svg": og("https://site.example/image.svg"),
      "https://site.example/image.svg": "<svg onload=alert(1)>",
    });
    expect(await findPageCover("https://site.example/gone", get)).toBeNull();
    expect(await findPageCover("https://site.example/none", get)).toBeNull();
    expect(await findPageCover("https://site.example/svg", get)).toBeNull();
    expect(await findPageCover("http://site.example/a", get)).toBeNull();
  });

  it("is not known when the site refuses", async () => {
    const get = site({ "https://site.example/a": 403 });
    await expect(findPageCover("https://site.example/a", get)).rejects.toThrow("HTTP 403");
  });
});

describe("the Steam cover of a title", () => {
  const steam = (names: string[]) =>
    vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith("https://store.steampowered.com/")
        ? Response.json({ items: names.map((name, index) => ({ id: index + 1, name, type: "app" })) })
        : new Response(JPEG),
    );

  it("needs one game with exactly that title", async () => {
    const fetchImpl = steam(["Deponia Doomsday", ...Array<string>(9).fill("Other"), "DEPONIA™"]);
    expect(await findSteamCover("Deponia", fetchImpl)).toEqual(JPEG);
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("/apps/11/");
    expect(await findSteamCover("Deponia", steam(["Deponia Doomsday"]))).toBeNull();
    expect(await findSteamCover("Deponia", steam(["Deponia", "Deponia"]))).toBeNull();
  });
});

describe("the cover finder", () => {
  it("fills what has no cover, once, and shows it in the library", async () => {
    setup();
    addContent("web:a", "deuchan", "video", "A", "https://site.example/a");
    addContent("gsm:g", "gsm", "game", "Deponia");
    const get = site({ "https://site.example/a": og("https://cdn.example/a.jpg") });
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("storesearch")
        ? Response.json({ items: [{ id: 7, name: "Deponia", type: "app" }] })
        : new Response(JPEG),
    );
    const covers = finder({ get, fetchImpl });
    expect(await covers.run()).toEqual({ searched: 2, found: 2 });
    expect([origin("web:a"), origin("gsm:g")]).toEqual(["web", "steam-auto"]);
    expect(listContents(db, DASHBOARD).contents.every((content) => content.cover !== null)).toBe(true);
    expect(await covers.run()).toEqual({ searched: 0, found: 0 });
  });

  it("asks nobody for what is turned off, and leaves alone YouTube, browser windows and chosen covers", async () => {
    setup();
    addContent("web:a", "deuchan", "video", "A", "https://site.example/a");
    addContent("web:chosen", "deuchan", "video", "C", "https://site.example/c");
    addContent("web:other", "deuchan", "video", "No address");
    addContent("yt:aaaaaaaaaaa", "deuchan", "video", "V", "https://www.youtube.com/watch?v=aaaaaaaaaaa");
    addContent("gsm:g", "gsm", "game", "Deponia");
    addContent("gsm:b", "gsm", "game", "(6) Video - YouTube - Brave");
    addContent("gsm:e", "gsm", "game", "Video - YouTube - Personal: Microsoft​ Edge");
    setManualCover(db, "web:chosen", JPEG);
    const get = site({});
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ items: [] }));

    await finder({ get, fetchImpl, webCovers: false, steamCovers: false }).run();
    expect(get).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();

    await finder({ get, fetchImpl }).run();
    expect(get.mock.calls.map(([url]) => url)).toEqual(["https://site.example/a"]);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("term"))).toEqual([
      "Deponia",
    ]);
    expect(origin("web:chosen")).toBe("manual");
  });

  it("tries again later, each time later, and gives up", async () => {
    setup();
    addContent("web:a", "deuchan", "video", "A", "https://site.example/a");
    let now = T;
    const get = site({ "https://site.example/a": 503 });
    const covers = finder({ get, now: () => now });
    expect((await covers.run()).searched).toBe(1);
    now += 5 * MINUTE - 1;
    expect((await covers.run()).searched).toBe(0);
    now += 1;
    expect((await covers.run()).searched).toBe(1);
    now += 5 * MINUTE;
    expect((await covers.run()).searched).toBe(0);
    for (let week = 0; week < 12; week += 1) {
      now += WEEK;
      await covers.run();
    }
    expect(get).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(db.prepare("SELECT result, error FROM cover_searches").get()).toEqual({
      result: "error",
      error: "site.example answered HTTP 503",
    });
  });

  it("does not bring back one the user removed, but fills in again after a chosen one is removed", async () => {
    setup();
    addContent("web:a", "deuchan", "video", "A", "https://site.example/a");
    const get = site({ "https://site.example/a": og("https://cdn.example/a.jpg") });
    const covers = finder({ get });
    await covers.run();
    // The user's own image replaces the found one; without it, the found one comes back
    setManualCover(db, "web:a", JPEG);
    expect(removeCover(db, "web:a")).toBe(true);
    await covers.run();
    expect(origin("web:a")).toBe("web");

    expect(removeCover(db, "web:a")).toBe(true);
    expect(await covers.run()).toEqual({ searched: 0, found: 0 });
    expect(origin("web:a")).toBeNull();
  });

  it("does not replace a cover that arrived while it was looking", async () => {
    setup();
    addContent("web:a", "deuchan", "video", "A", "https://site.example/a");
    const pages = site({ "https://site.example/a": og("https://cdn.example/a.jpg") });
    const get: PublicGet = async (url, options) => {
      if (url.endsWith(".jpg")) setManualCover(db, "web:a", JPEG);
      return pages(url, options);
    };
    expect((await finder({ get }).run()).found).toBe(0);
    expect(origin("web:a")).toBe("manual");
  });
});
