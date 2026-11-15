import { afterEach, describe, expect, it, vi } from "vitest";
import { listContents } from "../src/api/contents.ts";
import { getCover } from "../src/api/covers.ts";
import { createGsmConnector } from "../src/connectors/gsm/connector.ts";
import { decodeCover } from "../src/connectors/gsm/source.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { FakeGsm } from "./fake-gsm.ts";
import { silentLogger, tempDir } from "./helpers.ts";

const OPTIONS = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
// A 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let db: Database;
afterEach(() => db?.close());

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
