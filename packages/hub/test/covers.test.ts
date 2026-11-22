import { afterEach, describe, expect, it, vi } from "vitest";
import { listContents } from "../src/api/contents.ts";
import { MAX_COVER_BYTES, getCover, imageType, removeCover, setManualCover } from "../src/api/covers.ts";
import { searchSteam, setSteamCover } from "../src/api/steam.ts";
import { createGsmConnector } from "../src/connectors/gsm/connector.ts";
import { decodeCover } from "../src/connectors/gsm/source.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { FakeGsm } from "./fake-gsm.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const OPTIONS = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
// A 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let db: Database;
afterEach(() => {
  db?.close();
  db = undefined as unknown as Database;
});

function setup() {
  db = openDatabase(":memory:");
  applyMigrations(db);
}

describe("decodeCover", () => {
  it("reads data URLs and bare base64, and refuses what is not base64", () => {
    expect(decodeCover(`data:image/jpeg;base64,${PNG}`)).toMatchObject({ mime: "image/jpeg" });
    expect(decodeCover(PNG)?.data.length).toBeGreaterThan(10);
    expect(decodeCover("not an image!")).toBeNull();
  });
});

describe("game covers", () => {
  it("are copied from GSM, listed and served, and dropped when the game loses its image", async () => {
    setup();
    const gsm = new FakeGsm(tempDir());
    gsm.addGame("g", "Beispiel Spiel");
    gsm.write((writer) =>
      writer.prepare("UPDATE games SET image = ? WHERE id = 'g'").run(`data:image/png;base64,${PNG}`),
    );
    gsm.addLines([
      {
        id: "l1",
        gameId: "g",
        gameName: "Beispiel Spiel",
        text: "Hallo Welt",
        timestamp: 1_794_326_400,
        language: "de",
      },
    ]);
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    scheduler.register(
      createGsmConnector({
        db,
        locate: () => ({ dbPath: gsm.dbPath, dataDir: gsm.dataDir }),
        attribution: { refoldDecks: [] },
        timeZone: OPTIONS.timeZone,
      }),
    );
    await scheduler.run("gsm");

    const cover = await getCover(db, "gsm:g", { youtubeThumbnails: false });
    expect(cover?.mime).toBe("image/png");
    // The game has no time in German yet, but its row in contents carries the cover URL
    db.prepare("UPDATE lines SET seconds = 0").run();

    gsm.write((writer) => writer.prepare("UPDATE games SET image = '' WHERE id = 'g'").run());
    await scheduler.run("gsm");
    expect(await getCover(db, "gsm:g", { youtubeThumbnails: false })).toBeNull();
  });
});

describe("YouTube thumbnails", () => {
  it("are never fetched unless turned on, and fetched once when they are", async () => {
    setup();
    db.prepare(
      "INSERT INTO contents (id, source, kind, title, external_id) VALUES ('yt:aaaaaaaaaaa', 'deuchan', 'video', 'V', 'aaaaaaaaaaa')",
    ).run();
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(Buffer.from(PNG, "base64"), { headers: { "Content-Type": "image/jpeg" } }),
    );

    expect(await getCover(db, "yt:aaaaaaaaaaa", { youtubeThumbnails: false, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    expect((await getCover(db, "yt:aaaaaaaaaaa", { youtubeThumbnails: true, fetchImpl }))?.mime).toBe(
      "image/jpeg",
    );
    expect(await getCover(db, "yt:aaaaaaaaaaa", { youtubeThumbnails: true, fetchImpl })).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg");
  });

  it("are not fetched for unknown videos, and a failure gives no cover", async () => {
    setup();
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await getCover(db, "yt:bbbbbbbbbbb", { youtubeThumbnails: true, fetchImpl: failing })).toBeNull();
    db.prepare(
      "INSERT INTO contents (id, source, kind, title, external_id) VALUES ('yt:bbbbbbbbbbb', 'deuchan', 'video', 'V', 'bbbbbbbbbbb')",
    ).run();
    expect(await getCover(db, "yt:bbbbbbbbbbb", { youtubeThumbnails: true, fetchImpl: failing })).toBeNull();
  });

  it("show up as cover URLs only when turned on", () => {
    setup();
    db.prepare(
      "INSERT INTO contents (id, source, kind, title, external_id) VALUES ('yt:aaaaaaaaaaa', 'deuchan', 'video', 'V', 'aaaaaaaaaaa')",
    ).run();
    db.prepare(
      "INSERT INTO cards (note_id, word, deck, model, origin, content_id, created_ts) VALUES (1, 'w', 'd', 'm', 'youtube', 'yt:aaaaaaaaaaa', 1)",
    ).run();
    expect(listContents(db, OPTIONS).contents[0]?.cover).toBeNull();
    expect(listContents(db, { ...OPTIONS, youtubeThumbnails: true }).contents[0]?.cover).toBe(
      "/api/contents/yt%3Aaaaaaaaaaaa/cover",
    );
  });
});

describe("covers the user chooses", () => {
  const png = () => new Uint8Array(Buffer.from(PNG, "base64"));

  it("are kept, win over GSM's image and survive GSM syncs, and removing one brings GSM's back", async () => {
    setup();
    const gsm = new FakeGsm(tempDir());
    gsm.addGame("g", "Beispiel Spiel");
    gsm.write((writer) =>
      writer.prepare("UPDATE games SET image = ? WHERE id = 'g'").run(`data:image/png;base64,${PNG}`),
    );
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    scheduler.register(
      createGsmConnector({
        db,
        locate: () => ({ dbPath: gsm.dbPath, dataDir: gsm.dataDir }),
        attribution: { refoldDecks: [] },
        timeZone: OPTIONS.timeZone,
      }),
    );
    await scheduler.run("gsm");
    expect(db.prepare("SELECT origin FROM covers WHERE content_id = 'gsm:g'").get()).toEqual({
      origin: "gsm",
    });

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(setManualCover(db, "gsm:g", jpeg)).toEqual({ ok: true });
    await scheduler.run("gsm");
    expect(await getCover(db, "gsm:g", { youtubeThumbnails: false })).toMatchObject({ mime: "image/jpeg" });

    expect(removeCover(db, "gsm:g")).toBe(true);
    await scheduler.run("gsm");
    expect(await getCover(db, "gsm:g", { youtubeThumbnails: false })).toMatchObject({ mime: "image/png" });
  });

  it("must be an image of a known content, of 5 MB at most", () => {
    setup();
    db.prepare("INSERT INTO contents (id, source, kind, title) VALUES ('gsm:g', 'gsm', 'game', 'G')").run();
    expect(setManualCover(db, "gsm:nope", png())).toMatchObject({ ok: false, status: 404 });
    expect(setManualCover(db, "gsm:g", new TextEncoder().encode("<svg onload=alert(1)>"))).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(setManualCover(db, "gsm:g", new Uint8Array(MAX_COVER_BYTES + 1))).toMatchObject({
      ok: false,
      status: 413,
    });
    expect(imageType(png())).toBe("image/png");
  });

  it("can be uploaded and removed through the API", async () => {
    setup();
    db.prepare("INSERT INTO contents (id, source, kind, title) VALUES ('gsm:g', 'gsm', 'game', 'G')").run();
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    const app = await buildServer({ config: testConfig(), db, scheduler, webDistDir: tempDir() });
    const headers = { host: "127.0.0.1:7300", origin: "http://127.0.0.1:5173" };
    try {
      const put = await app.inject({
        method: "PUT",
        url: "/api/contents/gsm%3Ag/cover",
        headers: { ...headers, "content-type": "image/png" },
        payload: Buffer.from(PNG, "base64"),
      });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({ method: "GET", url: "/api/contents/gsm%3Ag/cover", headers });
      expect(get.headers["content-type"]).toBe("image/png");
      expect(listContents(db, OPTIONS).contents).toEqual([]); // no time yet, so not listed
      const removed = await app.inject({ method: "DELETE", url: "/api/contents/gsm%3Ag/cover", headers });
      expect(removed.json()).toEqual({ removed: true });
      // Another web page cannot change covers
      const evil = await app.inject({
        method: "PUT",
        url: "/api/contents/gsm%3Ag/cover",
        headers: { ...headers, origin: "https://evil.example", "content-type": "image/png" },
        payload: Buffer.from(PNG, "base64"),
      });
      expect(evil.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe("Steam covers", () => {
  const steam = (routes: Record<string, () => Response>) =>
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      return key ? routes[key]!() : new Response("", { status: 404 });
    });

  it("are searched by title, offering the portrait cover of each game", async () => {
    const fetchImpl = steam({
      "https://store.steampowered.com/api/storesearch/": () =>
        Response.json({
          total: 2,
          items: [{ id: 787480, name: "Phoenix Wright: Ace Attorney Trilogy", type: "app" }],
        }),
    });
    expect(await searchSteam("Phoenix Wright", fetchImpl)).toEqual([
      {
        appId: 787480,
        name: "Phoenix Wright: Ace Attorney Trilogy",
        image:
          "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/787480/library_600x900.jpg",
        header: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/787480/header.jpg",
      },
    ]);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get("term")).toBe("Phoenix Wright");
    expect(await searchSteam(" ", fetchImpl)).toEqual([]);
  });

  it("are downloaded and kept, falling back to the wide header when there is no portrait", async () => {
    setup();
    db.prepare("INSERT INTO contents (id, source, kind, title) VALUES ('gsm:g', 'gsm', 'game', 'G')").run();
    const fetchImpl = steam({
      "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/42/header.jpg": () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]), {
          headers: { "Content-Type": "image/jpeg" },
        }),
    });
    expect(await setSteamCover(db, "gsm:g", 42, fetchImpl)).toEqual({ ok: true });
    expect(db.prepare("SELECT origin, mime FROM covers WHERE content_id = 'gsm:g'").get()).toEqual({
      origin: "steam",
      mime: "image/jpeg",
    });
    expect(await setSteamCover(db, "gsm:g", 43, fetchImpl)).toMatchObject({
      ok: false,
      error: "no_steam_image",
    });
    expect(removeCover(db, "gsm:g")).toBe(true);
  });
});
