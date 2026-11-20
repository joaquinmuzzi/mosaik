import type { IngestResponse, SourcesResponse } from "@mosaik/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { itemTitle, normalizeTitle, youtubeVideoIdOf } from "../src/derive/deuchan.ts";
import { ingestEvents } from "../src/ingest.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const HOST = { host: "127.0.0.1:7300" };
const EXTENSION = { ...HOST, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" };
const VIDEO = "sqNV-C54MWI";

/** The batch Deuchan sent from Chrome 156 to a test hub (from the PR that added the export). */
const REAL_BATCH = {
  events: [
    {
      id: "deuchan:iv:f94a2a2c-8ca5-491d-b643-1fd1b67dc655",
      source: "deuchan",
      kind: "watch_interval",
      language: "de",
      from: 1794684399313,
      to: 1794684413578,
      seconds: 14.265,
      videoId: VIDEO,
      title: "tagesschau 20:00 Uhr, 09.11.2026",
    },
    {
      id: "deuchan:day:2026-11-14:1794684451183",
      source: "deuchan",
      kind: "day_total",
      language: "de",
      day: "2026-11-14",
      at: 1794684451183,
      seconds: 14,
      videos: [{ videoId: VIDEO, title: "tagesschau 20:00 Uhr, 09.11.2026", seconds: 14.265 }],
    },
  ],
};

let app: FastifyInstance;
let db: Database;
let open = false;

afterEach(async () => {
  if (!open) return;
  await app.close();
  db.close();
  open = false;
});

async function setup() {
  open = true;
  db = openDatabase(":memory:");
  applyMigrations(db);
  const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
  app = await buildServer({ config: testConfig(), db, scheduler, webDistDir: tempDir() });
}

const send = (body: unknown, headers: Record<string, string> = EXTENSION) =>
  app.inject({ method: "POST", url: "/api/ingest/events", headers, payload: body as object });

let counter = 0;
const interval = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
  id: `deuchan:iv:test-${(counter += 1)}`,
  source: "deuchan",
  kind: "watch_interval",
  language: "de",
  from,
  to,
  seconds: (to - from) / 1000,
  videoId: VIDEO,
  title: "tagesschau 20:00 Uhr, 09.11.2026",
  ...extra,
});

const rows = (sql: string) => db.prepare(sql).all();

describe("POST /api/ingest/events", () => {
  it("takes the batch Deuchan really sends", async () => {
    await setup();
    const response = await send(REAL_BATCH);
    expect(response.statusCode).toBe(200);
    expect(response.json<IngestResponse>()).toEqual({ accepted: 2, duplicates: 0, rejected: [] });

    expect(rows("SELECT id, kind, title, external_id FROM contents WHERE source = 'deuchan'")).toEqual([
      { id: `yt:${VIDEO}`, kind: "video", title: "tagesschau 20:00 Uhr, 09.11.2026", external_id: VIDEO },
    ]);
    expect(rows("SELECT medium, language, content_id, start_ts, end_ts, seconds FROM sessions")).toEqual([
      {
        medium: "video",
        language: "de",
        content_id: `yt:${VIDEO}`,
        start_ts: 1794684399313,
        end_ts: 1794684413578,
        seconds: 14.265,
      },
    ]);
    expect(rows("SELECT day, seconds, at FROM day_totals")).toEqual([
      { day: "2026-11-14", seconds: 14, at: 1794684451183 },
    ]);

    // The dashboard sees the source, without a sync button (Deuchan sends, the hub does not fetch)
    const sources = (
      await app.inject({ method: "GET", url: "/api/sources", headers: HOST })
    ).json<SourcesResponse>();
    expect(sources.sources).toEqual([
      expect.objectContaining({
        source: "deuchan",
        registered: false,
        lastError: null,
        lastOkAt: expect.any(Number),
        lastSummary: { events: 2, videos: 1, sessions: 1, watchSeconds: 14, days: 1 },
      }),
    ]);
  });

  it("ignores events it already has, so a batch can be resent", async () => {
    await setup();
    await send(REAL_BATCH);
    const response = await send(REAL_BATCH);
    expect(response.json<IngestResponse>()).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(rows("SELECT COUNT(*) AS count FROM raw_events")).toEqual([{ count: 2 }]);
  });

  it("rejects bad events one by one and keeps the rest", async () => {
    await setup();
    const bad = { ...REAL_BATCH.events[0], id: "deuchan:iv:bad", to: 1 };
    const response = await send({ events: [bad, "nonsense", REAL_BATCH.events[1]] });
    const body = response.json<IngestResponse>();
    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([
      { index: 0, id: "deuchan:iv:bad", error: expect.stringContaining("to") },
      { index: 1, error: expect.any(String) },
    ]);
  });

  it("answers 400 to a body that is not a batch", async () => {
    await setup();
    for (const body of [{ events: [] }, { nope: true }, [REAL_BATCH.events[0]]]) {
      const response = await send(body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "invalid_batch" });
    }
  });

  it("only takes events from extensions, programs and this computer's pages", async () => {
    await setup();
    expect((await send(REAL_BATCH, { ...HOST, origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await send(REAL_BATCH, HOST)).statusCode).toBe(200);
  });

  it("takes a large backfill in one request", async () => {
    await setup();
    const videos = Array.from({ length: 200 }, (_, index) => ({
      videoId: `vid${String(index).padStart(8, "0")}`,
      title: "Ein ziemlich langer Videotitel, damit der Stapel wirklich groß wird ".repeat(2),
      seconds: 60,
    }));
    const events = Array.from({ length: 200 }, (_, index) => ({
      id: `deuchan:day:2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}:${index}`,
      source: "deuchan",
      kind: "day_total",
      language: "de",
      day: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      at: 1794684451183 + index,
      seconds: 12000,
      videos,
    }));
    const body = { events };
    expect(JSON.stringify(body).length).toBeGreaterThan(1024 * 1024);
    const response = await send(body);
    expect(response.statusCode).toBe(200);
    expect(response.json<IngestResponse>()).toMatchObject({ accepted: 200, rejected: [] });
  });
});

describe("what the hub makes of Deuchan's events", () => {
  // 2026-11-14 16:00 in Buenos Aires
  const T = Date.UTC(2026, 10, 14, 19, 0);

  it("joins the intervals of a video less than 10 minutes apart into one session", async () => {
    await setup();
    await send({
      events: [
        interval(T, T + 60_000),
        interval(T + 5 * 60_000, T + 6 * 60_000), // 4 minutes later: same session
        interval(T + 20 * 60_000, T + 21 * 60_000), // 14 minutes later: a new one
      ],
    });
    expect(rows("SELECT start_ts, end_ts, seconds FROM sessions ORDER BY start_ts")).toEqual([
      { start_ts: T, end_ts: T + 6 * 60_000, seconds: 120 },
      { start_ts: T + 20 * 60_000, end_ts: T + 21 * 60_000, seconds: 60 },
    ]);
  });

  it("keeps the newest snapshot of a day, whatever order they arrive in", async () => {
    await setup();
    const snapshot = (at: number, seconds: number) => ({
      ...REAL_BATCH.events[1],
      id: `deuchan:day:2026-11-14:${at}`,
      at,
      seconds,
      videos: undefined,
    });
    await send({ events: [snapshot(T + 2000, 300)] });
    await send({ events: [snapshot(T + 1000, 999)] });
    expect(rows("SELECT seconds FROM day_totals")).toEqual([{ seconds: 300 }]);
    // A day corrected to 0 is a real value
    await send({ events: [snapshot(T + 3000, 0)] });
    expect(rows("SELECT seconds FROM day_totals")).toEqual([{ seconds: 0 }]);
  });

  it("drops the intervals of a video removed from a day", async () => {
    await setup();
    await send({ events: [interval(T, T + 60_000), interval(T, T + 60_000, { videoId: "otherVideo1" })] });
    const removal = {
      id: `deuchan:rm:2026-11-14:${VIDEO}:${T + 65_000}`,
      source: "deuchan",
      kind: "video_removed",
      language: "de",
      day: "2026-11-14",
      at: T + 65_000,
      videoId: VIDEO,
    };
    expect((await send({ events: [removal] })).json<IngestResponse>()).toMatchObject({
      accepted: 1,
      rejected: [],
    });
    expect(rows("SELECT content_id FROM sessions")).toEqual([{ content_id: "yt:otherVideo1" }]);
  });

  it("keeps what an item counted after it was removed from its day", async () => {
    await setup();
    const removal = {
      id: `deuchan:rm:2026-11-14:${VIDEO}:${T + 60_000}`,
      source: "deuchan",
      kind: "video_removed",
      language: "de",
      day: "2026-11-14",
      at: T + 60_000,
      videoId: VIDEO,
    };
    // Before the removal, across it (half after it), and after it; sent in any order
    await send({ events: [interval(T + 90_000, T + 150_000), removal] });
    await send({ events: [interval(T, T + 30_000), interval(T + 30_000, T + 90_000)] });
    expect(rows("SELECT start_ts, end_ts, seconds FROM sessions")).toEqual([
      { start_ts: T + 60_000, end_ts: T + 150_000, seconds: 90 },
    ]);
  });

  it("gives a card the video it was mined from, by URL or by title", async () => {
    await setup();
    const note = (noteId: number, fields: Record<string, string>) =>
      db
        .prepare(
          `INSERT INTO raw_anki_notes (note_id, model, deck, fields, tags, mod, payload, synced_at)
           VALUES (?, 'Kiku', 'German Mining', ?, '[]', 0, '{}', 0)`,
        )
        .run(noteId, JSON.stringify({ Expression: "Wort", ...fields }));
    // Mined while watching: Yomitan's title of the tab, with its noise
    note(T + 30_000, { MiscInfo: "(3) tagesschau 20:00 Uhr, 09.11.2026 - YouTube" });
    // Mined a day later from a video Deuchan never saw that day
    note(T + 3 * 86_400_000, { MiscInfo: "tagesschau 20:00 Uhr, 09.11.2026 - YouTube" });
    // A URL field wins over anything else
    note(T + 60_000, { MiscInfo: "Something", URL: "https://www.youtube.com/watch?v=abcdefghijk&t=42s" });

    await send(REAL_BATCH);
    expect(rows("SELECT note_id, origin, content_id FROM cards ORDER BY note_id")).toEqual([
      { note_id: T + 30_000, origin: "youtube", content_id: `yt:${VIDEO}` },
      { note_id: T + 60_000, origin: "youtube", content_id: "yt:abcdefghijk" },
      { note_id: T + 3 * 86_400_000, origin: "unknown", content_id: null },
    ]);
  });
});

describe("title and URL helpers", () => {
  it("compare titles without case, spacing or the YouTube suffix", () => {
    expect(normalizeTitle("  Tagesschau   20:00 Uhr - YouTube")).toBe("tagesschau 20:00 uhr");
  });

  it("take the count of notifications off the title of a page, not of a YouTube video", () => {
    expect(itemTitle({}, "(2) LumiiMari - Twitch")).toBe("LumiiMari - Twitch");
    expect(itemTitle({}, "(99+) Facebook")).toBe("Facebook");
    expect(itemTitle({}, "Teil (2) der Serie")).toBe("Teil (2) der Serie");
    expect(itemTitle({ videoId: VIDEO }, "(2) Folge zwei")).toBe("(2) Folge zwei");
    expect(itemTitle({}, undefined)).toBe("");
  });

  it("find the video id in the usual YouTube URLs", () => {
    expect(youtubeVideoIdOf("https://www.youtube.com/watch?v=sqNV-C54MWI")).toBe(VIDEO);
    expect(youtubeVideoIdOf("https://youtube.com/watch?feature=share&v=sqNV-C54MWI")).toBe(VIDEO);
    expect(youtubeVideoIdOf("https://youtu.be/sqNV-C54MWI?t=10")).toBe(VIDEO);
    expect(youtubeVideoIdOf("https://www.youtube.com/shorts/sqNV-C54MWI")).toBe(VIDEO);
    expect(youtubeVideoIdOf("https://example.com/watch?v=sqNV-C54MWI")).toBeNull();
  });
});

describe("Deuchan on several devices", () => {
  const T = Date.UTC(2026, 10, 14, 19, 0);
  const DAY = "2026-11-14";
  const config = testConfig();
  const sendFrom = (device: string, events: unknown[]) =>
    ingestEvents(
      db,
      { events },
      {
        attribution: { refoldDecks: config.ankiRefoldDecks, timeZone: config.timeZone },
        timeZone: config.timeZone,
        device,
      },
    );
  const snapshot = (device: string, at: number, seconds: number, videos: unknown[], extra = {}) => ({
    id: `deuchan:day:${DAY}:${device}:${at}`,
    source: "deuchan",
    kind: "day_total",
    language: "de",
    day: DAY,
    at,
    seconds,
    videos,
    ...extra,
  });
  const web = {
    itemId: "web:abc123",
    url: "https://www.twitch.tv/videos/1",
    site: "twitch.tv",
    title: "Stream",
  };

  it("adds up the devices of a day and lists the items of all of them", async () => {
    await setup();
    sendFrom("principal", [
      snapshot("principal", T, 600, [{ videoId: VIDEO, title: "Tagesschau", seconds: 600 }]),
    ]);
    sendFrom("joaquin", [
      snapshot("joaquin", T + 10, 400, [
        { videoId: VIDEO, title: "Tagesschau", seconds: 100 },
        { ...web, seconds: 300 },
      ]),
    ]);
    expect(rows("SELECT device, seconds FROM day_totals ORDER BY device")).toEqual([
      { device: "joaquin", seconds: 400 },
      { device: "principal", seconds: 600 },
    ]);
    const days = await app.inject({
      method: "GET",
      url: `/api/agent/deuchan/days?from=${DAY}&to=${DAY}`,
      headers: HOST,
    });
    expect(days.statusCode).toBe(200);
    expect(days.json()).toEqual({
      days: {
        [DAY]: {
          seconds: 1000,
          readingSeconds: 0,
          devices: { joaquin: 400, principal: 600 },
          items: [
            {
              id: `yt:${VIDEO}`,
              title: "Tagesschau",
              url: `https://www.youtube.com/watch?v=${VIDEO}`,
              contentKind: "video",
              seconds: 700,
              devices: { principal: 600, joaquin: 100 },
            },
            {
              id: "web:abc123",
              title: "Stream",
              url: "https://www.twitch.tv/videos/1",
              contentKind: "video",
              seconds: 300,
              devices: { joaquin: 300 },
            },
          ],
        },
      },
    });
  });

  it("replaces a device's snapshot with its newer one, without touching the others", async () => {
    await setup();
    sendFrom("principal", [snapshot("principal", T, 600, [])]);
    sendFrom("joaquin", [snapshot("joaquin", T + 10, 400, [])]);
    sendFrom("principal", [snapshot("principal", T + 20, 200, [])]);
    sendFrom("principal", [snapshot("principal", T + 5, 999, [])]);
    expect(rows("SELECT device, seconds FROM day_totals ORDER BY device")).toEqual([
      { device: "joaquin", seconds: 400 },
      { device: "principal", seconds: 200 },
    ]);
  });

  it("keeps the url of items from other sites and counts reading as reading", async () => {
    await setup();
    sendFrom("joaquin", [
      interval(T, T + 60_000, { videoId: undefined, ...web }),
      interval(T, T + 120_000, {
        videoId: undefined,
        itemId: "web:comic1",
        url: "https://example.com/comic",
        title: "Asterix",
        contentKind: "reading",
      }),
      snapshot("joaquin", T + 200_000, 180, [], { readingSeconds: 120 }),
    ]);
    expect(rows("SELECT id, kind, title, external_id, meta FROM contents ORDER BY id")).toEqual([
      {
        id: "web:abc123",
        kind: "video",
        title: "Stream",
        external_id: null,
        meta: JSON.stringify({ url: "https://www.twitch.tv/videos/1" }),
      },
      {
        id: "web:comic1",
        kind: "book",
        title: "Asterix",
        external_id: null,
        meta: JSON.stringify({ url: "https://example.com/comic" }),
      },
    ]);
    expect(rows("SELECT content_id, medium, device FROM sessions ORDER BY content_id")).toEqual([
      { content_id: "web:abc123", medium: "video", device: "joaquin" },
      { content_id: "web:comic1", medium: "reading", device: "joaquin" },
    ]);
    expect(rows("SELECT reading_seconds FROM day_totals")).toEqual([{ reading_seconds: 120 }]);
  });

  it("rejects an item without videoId or itemId", async () => {
    await setup();
    const result = sendFrom("joaquin", [interval(T, T + 60_000, { videoId: undefined })]);
    expect(result.body).toMatchObject({ accepted: 0, rejected: [{ index: 0 }] });
  });

  it("answers 400 to a bad range of days", async () => {
    await setup();
    const bad = await app.inject({
      method: "GET",
      url: "/api/agent/deuchan/days?from=2026-11-20&to=2026-11-10",
      headers: HOST,
    });
    expect(bad.statusCode).toBe(400);
    const tooLong = await app.inject({
      method: "GET",
      url: "/api/agent/deuchan/days?from=2024-01-01&to=2026-01-01",
      headers: HOST,
    });
    expect(tooLong.statusCode).toBe(400);
  });
});
