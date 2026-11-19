import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, ankiStats, dayDetail, isDay, mondayOf, overview } from "../src/api/dashboard.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const OPTIONS = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
/** Buenos Aires local time (UTC-3) to epoch ms. */
const local = (day: string, time: string) => Date.parse(`${day}T${time}:00-03:00`);
const NOW = local("2026-11-14", "18:00");

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
  const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);

  // GSM: a German session from 23:00 to 03:50 the night of the 13th, and a Japanese one on the 14th
  run(`INSERT INTO contents (id, source, kind, title) VALUES ('gsm:g', 'gsm', 'game', 'Beispiel Spiel')`);
  run(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds) VALUES
     ('gsm:a', 'gsm', 'game', 'de', 'gsm:g', ?, ?, 300), ('gsm:b', 'gsm', 'game', 'ja', 'gsm:g', ?, ?, 50)`,
    local("2026-11-13", "23:00"),
    local("2026-11-14", "03:50"),
    local("2026-11-14", "12:00"),
    local("2026-11-14", "12:10"),
  );
  const line = (id: string, session: string, ts: number, seconds: number) =>
    run(
      `INSERT INTO lines (id, source, content_id, session_id, ts, text, chars, seconds) VALUES (?, 'gsm', 'gsm:g', ?, ?, 'x', 10, ?)`,
      id,
      session,
      ts,
      seconds,
    );
  line("gsm:1", "gsm:a", local("2026-11-13", "23:00"), 100);
  line("gsm:2", "gsm:a", local("2026-11-14", "03:50"), 200); // before 4:00: still the 13th
  line("gsm:3", "gsm:b", local("2026-11-14", "12:00"), 50);

  // Deuchan: totals for two days (one of them zero), and the snapshot with its videos
  run(
    `INSERT INTO day_totals (source, device, day, seconds, at, event_id) VALUES
     ('deuchan', 'principal', '2026-11-12', 600, 1, 'd1'), ('deuchan', 'principal', '2026-11-14', 0, 2, 'd2')`,
  );
  run(
    `INSERT INTO raw_events (id, source, kind, received_at, payload) VALUES ('d1', 'deuchan', 'day_total', 0, ?)`,
    JSON.stringify({
      id: "d1",
      source: "deuchan",
      kind: "day_total",
      day: "2026-11-12",
      at: 1,
      seconds: 600,
      videos: [
        { videoId: "aaaaaaaaaaa", title: "Kurz", seconds: 100 },
        { videoId: "bbbbbbbbbbb", title: "Lang", seconds: 500 },
      ],
    }),
  );

  // Anki: two mined cards and one premade, with reviews
  run(
    `INSERT INTO cards (note_id, word, deck, model, origin, content_id, source_title, created_ts) VALUES
     (?, 'Wort', 'German Mining', 'Kiku', 'gsm', 'gsm:g', 'Beispiel Spiel', ?),
     (?, 'Haus', 'German Mining', 'Kiku', 'unknown', NULL, 'Ein Video', ?),
     (1, 'haben', 'Refold', 'Alemán-mil', 'refold-1k', NULL, NULL, 1)`,
    local("2026-11-14", "02:00"),
    local("2026-11-14", "02:00"),
    local("2026-11-14", "10:00"),
    local("2026-11-14", "10:00"),
  );
  run(
    `INSERT INTO raw_anki_cards (card_id, note_id, deck, type, queue, interval, due, reps, lapses, mod, payload, synced_at) VALUES
     (11, 1, 'Refold', 2, 2, 30, 0, 9, 0, 0, '{}', 0)`,
  );
  const review = (id: number, note: number, type: number, ease: number, ivl: number, lastIvl: number) =>
    run(
      `INSERT INTO reviews (review_id, note_id, card_id, ts, ease, ivl, last_ivl, type, time_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 4000)`,
      id,
      note,
      note + 10,
      id,
      ease,
      ivl,
      lastIvl,
      type,
    );
  review(local("2026-11-13", "20:00"), 1, 0, 3, 1, 0); // first seen on the 13th
  review(local("2026-11-14", "09:00"), 1, 1, 3, 25, 10); // young review, passed; now mature
  review(local("2026-11-14", "09:05"), 1, 1, 1, 1, 25); // mature review, failed
  review(local("2026-11-14", "09:10"), 1, 5, 0, 30, 1); // a reschedule: not a review
  review(local("2026-11-14", "11:00"), local("2026-11-14", "10:00"), 0, 3, 1, 0); // new mined card
});

afterEach(() => db.close());

describe("day helpers", () => {
  it("add days, find Mondays and check day strings", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(mondayOf("2026-11-14")).toBe("2026-11-09");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(isDay("2026-11-14")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("14/11/2026")).toBe(false);
  });
});

describe("overview", () => {
  it("adds up each day by source, with Mosaik's cutoff and only the target language", () => {
    const result = overview(db, OPTIONS, 3, NOW);
    expect(result).toMatchObject({ today: "2026-11-14", cutoffHour: 4, timeZone: "America/Buenos_Aires" });
    expect(result.days).toEqual([
      { day: "2026-11-12", gsmSeconds: 0, deuchanSeconds: 600, reviews: 0, reviewSeconds: 0, cardsMined: 0 },
      // The 03:50 line and the 02:00 card belong to the night of the 13th
      {
        day: "2026-11-13",
        gsmSeconds: 300,
        deuchanSeconds: null,
        reviews: 1,
        reviewSeconds: 4,
        cardsMined: 1,
      },
      // The Japanese session and the reschedule do not count; Deuchan's 0 is a real 0
      { day: "2026-11-14", gsmSeconds: 0, deuchanSeconds: 0, reviews: 3, reviewSeconds: 12, cardsMined: 1 },
    ]);
  });

  it("counts the streak from yesterday when today has nothing yet", () => {
    expect(overview(db, OPTIONS, 1, NOW).streak).toBe(2);
    expect(overview(db, OPTIONS, 1, local("2026-11-16", "12:00")).streak).toBe(0);
  });
});

describe("dayDetail", () => {
  it("explains a day: GSM sessions, Deuchan's videos and Anki", () => {
    const detail = dayDetail(db, OPTIONS, "2026-11-13");
    expect(detail.gsm).toEqual({
      seconds: 300,
      sessions: [
        {
          id: "gsm:a",
          title: "Beispiel Spiel",
          start: local("2026-11-13", "23:00"),
          end: local("2026-11-14", "03:50"),
          seconds: 300,
          characters: 20,
          lines: 2,
        },
      ],
      otherLanguageSeconds: 0,
    });
    expect(detail.deuchan).toEqual({
      seconds: null,
      readingSeconds: 0,
      devices: [],
      snapshotAt: null,
      videos: [],
    });
    expect(detail.anki).toMatchObject({ reviews: 1, newCards: 1, byType: { learning: 1 } });
    expect(detail.anki.mined).toEqual([
      expect.objectContaining({ word: "Wort", origin: "gsm", contentTitle: "Beispiel Spiel" }),
    ]);
  });

  it("shows the other-language time apart and the videos longest first", () => {
    expect(dayDetail(db, OPTIONS, "2026-11-14").gsm).toMatchObject({ seconds: 0, otherLanguageSeconds: 50 });
    expect(dayDetail(db, OPTIONS, "2026-11-12").deuchan).toEqual({
      seconds: 600,
      readingSeconds: 0,
      devices: [{ device: "principal", label: "principal", seconds: 600, at: 1 }],
      snapshotAt: 1,
      videos: [
        {
          id: "yt:bbbbbbbbbbb",
          videoId: "bbbbbbbbbbb",
          title: "Lang",
          url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
          contentKind: "video",
          seconds: 500,
          devices: ["principal"],
        },
        {
          id: "yt:aaaaaaaaaaa",
          videoId: "aaaaaaaaaaa",
          title: "Kurz",
          url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
          contentKind: "video",
          seconds: 100,
          devices: ["principal"],
        },
      ],
    });
  });
});

describe("device labels", () => {
  it("shows each device by its label, and a label once for the devices that share it", () => {
    db.prepare("INSERT INTO devices (name, token_hash, created_at, label) VALUES (?, ?, ?, ?)").run(
      "principal",
      "hash",
      1,
      "PC2",
    );
    const deuchan = dayDetail(db, OPTIONS, "2026-11-12").deuchan;
    expect(deuchan.devices).toEqual([{ device: "principal", label: "PC2", seconds: 600, at: 1 }]);
    expect(deuchan.videos.map((video) => video.devices)).toEqual([["PC2"], ["PC2"]]);
  });
});

describe("ankiStats", () => {
  it("gives cards, mature cards and retention per origin", () => {
    const stats = ankiStats(db, OPTIONS, NOW);
    expect(stats.origins).toEqual([
      {
        origin: "gsm",
        cards: 1,
        mature: 0,
        young: { reviews: 0, passed: 0 },
        matureRetention: { reviews: 0, passed: 0 },
      },
      {
        origin: "refold-1k",
        cards: 1,
        mature: 1,
        young: { reviews: 1, passed: 1 },
        matureRetention: { reviews: 1, passed: 0 },
      },
      {
        origin: "unknown",
        cards: 1,
        mature: 0,
        young: { reviews: 0, passed: 0 },
        matureRetention: { reviews: 0, passed: 0 },
      },
    ]);
  });

  it("follows the weeks: immersion, and cards that reached maturity for the first time, cumulative", () => {
    expect(ankiStats(db, OPTIONS, NOW).weeks).toEqual([
      { week: "2026-11-09", gsmSeconds: 300, deuchanSeconds: 600, maturedMined: 0, maturedRefold: 1 },
    ]);
  });
});

describe("the dashboard routes", () => {
  it("answer, and refuse a day that is not one", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    const app = await buildServer({ config: testConfig(), db, scheduler, webDistDir: tempDir() });
    const get = (url: string) => app.inject({ method: "GET", url, headers: { host: "127.0.0.1:7300" } });
    try {
      expect((await get("/api/overview?days=5")).json().days).toHaveLength(5);
      expect((await get("/api/days/2026-11-13")).json().gsm.seconds).toBe(300);
      expect((await get("/api/days/2026-13-01")).statusCode).toBe(400);
      expect((await get("/api/anki")).json().origins).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
});
