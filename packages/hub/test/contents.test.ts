import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentDetail, listContents, searchLines } from "../src/api/contents.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const OPTIONS = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
const local = (day: string, time: string) => Date.parse(`${day}T${time}:00-03:00`);

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
  const run = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).run(...values);

  run(
    `INSERT INTO contents (id, source, kind, title, external_id, total_units, unit) VALUES
     ('gsm:g', 'gsm', 'game', 'Beispiel Spiel', 'g', 100, 'characters'),
     ('gsm:jp', 'gsm', 'game', 'Japanischer Test', 'jp', NULL, 'characters'),
     ('yt:aaaaaaaaaaa', 'deuchan', 'video', 'Ein Video', 'aaaaaaaaaaa', NULL, NULL)`,
  );
  run(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds, units, unit, lines) VALUES
     ('gsm:s1', 'gsm', 'game', 'de', 'gsm:g', ?, ?, 1800, 40, 'characters', 3),
     ('gsm:s2', 'gsm', 'game', 'ja', 'gsm:jp', ?, ?, 600, 500, 'characters', 2)`,
    local("2026-11-13", "20:00"),
    local("2026-11-13", "20:30"),
    local("2026-11-12", "20:00"),
    local("2026-11-12", "20:10"),
  );
  const line = (
    id: string,
    session: string,
    content: string,
    ts: number,
    text: string,
    seconds: number,
    notes: string | null,
  ) =>
    run(
      `INSERT INTO lines (id, source, content_id, session_id, ts, text, chars, seconds, note_ids) VALUES (?, 'gsm', ?, ?, ?, ?, 10, ?, ?)`,
      id,
      content,
      session,
      ts,
      text,
      seconds,
      notes,
    );
  line("gsm:1", "gsm:s1", "gsm:g", local("2026-11-13", "20:00"), "Ich erhebe Einwand!", 900, null);
  line("gsm:2", "gsm:s1", "gsm:g", local("2026-11-13", "20:15"), "Zum Glück bin ich pünktlich.", 900, "[42]");
  line("gsm:3", "gsm:s1", "gsm:g", local("2026-11-13", "20:30"), 'Er sagte: "Nein".', 0, null);
  line("gsm:4", "gsm:s2", "gsm:jp", local("2026-11-12", "20:00"), "逆転裁判の時間", 600, null);
  db.exec("INSERT INTO lines_fts (lines_fts) VALUES ('rebuild')");

  run(
    `INSERT INTO cards (note_id, word, deck, model, origin, content_id, line_id, created_ts) VALUES
     (42, 'Glück', 'German Mining', 'Kiku', 'gsm', 'gsm:g', 'gsm:2', ?),
     (43, 'Video', 'German Mining', 'Kiku', 'youtube', 'yt:aaaaaaaaaaa', NULL, ?)`,
    local("2026-11-13", "20:16"),
    local("2026-11-11", "15:00"),
  );
  // Deuchan: two snapshots of the 11th (only the newest counts) and one of the 12th
  const snapshot = (day: string, at: number, seconds: number) =>
    run(
      `INSERT INTO raw_events (id, source, kind, received_at, payload) VALUES (?, 'deuchan', 'day_total', 0, ?)`,
      `d:${day}:${at}`,
      JSON.stringify({ day, at, seconds, videos: [{ videoId: "aaaaaaaaaaa", title: "Ein Video", seconds }] }),
    );
  snapshot("2026-11-11", 1, 100);
  snapshot("2026-11-11", 2, 300);
  snapshot("2026-11-12", 3, 60);
  run(
    `INSERT INTO day_totals (source, day, seconds, at) VALUES ('deuchan', '2026-11-11', 300, 2), ('deuchan', '2026-11-12', 60, 3)`,
  );
});

afterEach(() => db.close());

describe("listContents", () => {
  it("gives each content its time, sessions, characters and cards, newest first", () => {
    expect(listContents(db, OPTIONS).contents).toEqual([
      {
        id: "gsm:g",
        source: "gsm",
        kind: "game",
        title: "Beispiel Spiel",
        seconds: 1800,
        sessions: 1,
        characters: 40,
        cardsMined: 1,
        firstDay: "2026-11-13",
        lastDay: "2026-11-13",
      },
      {
        id: "yt:aaaaaaaaaaa",
        source: "deuchan",
        kind: "video",
        title: "Ein Video",
        // The newest snapshot of each day: 300 + 60
        seconds: 360,
        sessions: 0,
        characters: null,
        cardsMined: 1,
        firstDay: "2026-11-11",
        lastDay: "2026-11-12",
      },
      // The game read only in Japanese is not listed
    ]);
  });
});

describe("contentDetail", () => {
  it("shows a game: speed and share read, days, sessions, cards with their sentence, and lines", () => {
    const detail = contentDetail(db, OPTIONS, "gsm:g")!;
    expect(detail.content).toMatchObject({ title: "Beispiel Spiel", url: null, totalUnits: 100 });
    expect(detail.charactersPerHour).toBe(80);
    expect(detail.completion).toBe(0.4);
    expect(detail.days).toEqual([{ day: "2026-11-13", seconds: 1800 }]);
    expect(detail.sessions).toHaveLength(1);
    expect(detail.cards).toEqual([
      {
        noteId: 42,
        word: "Glück",
        created: local("2026-11-13", "20:16"),
        line: "Zum Glück bin ich pünktlich.",
      },
    ]);
    expect(detail.lines.map((line) => [line.id, line.mined])).toEqual([
      ["gsm:3", []],
      ["gsm:2", ["Glück"]],
      ["gsm:1", []],
    ]);
  });

  it("shows a video without a speed or a share, which would mean nothing", () => {
    const detail = contentDetail(db, OPTIONS, "yt:aaaaaaaaaaa")!;
    expect(detail.content.url).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(detail.charactersPerHour).toBeNull();
    expect(detail.completion).toBeNull();
    expect(detail.days).toEqual([
      { day: "2026-11-11", seconds: 300 },
      { day: "2026-11-12", seconds: 60 },
    ]);
  });

  it("is null for an unknown content", () => {
    expect(contentDetail(db, OPTIONS, "gsm:nope")).toBeNull();
  });
});

describe("searchLines", () => {
  it("finds words, inside compounds too, without case or accents", () => {
    expect(searchLines(db, OPTIONS, "einwand").hits.map((hit) => hit.id)).toEqual(["gsm:1"]);
    expect(searchLines(db, OPTIONS, "wand").hits.map((hit) => hit.id)).toEqual(["gsm:1"]);
    expect(searchLines(db, OPTIONS, "punktlich").hits.map((hit) => hit.id)).toEqual(["gsm:2"]);
  });

  it("says which card came from a line, and which day it was read", () => {
    expect(searchLines(db, OPTIONS, "Glück").hits).toEqual([
      {
        id: "gsm:2",
        ts: local("2026-11-13", "20:15"),
        text: "Zum Glück bin ich pünktlich.",
        contentId: "gsm:g",
        contentTitle: "Beispiel Spiel",
        day: "2026-11-13",
        mined: ["Glück"],
      },
    ]);
  });

  it("treats quotes and operators as plain text, and needs three characters", () => {
    expect(searchLines(db, OPTIONS, '"Nein"').hits.map((hit) => hit.id)).toEqual(["gsm:3"]);
    expect(searchLines(db, OPTIONS, "ich OR nein").hits).toEqual([]);
    expect(searchLines(db, OPTIONS, "ic")).toEqual({ query: "ic", hits: [], more: false });
  });

  it("can be limited to one content, and says when there is more", () => {
    expect(searchLines(db, OPTIONS, "ich", { contentId: "gsm:jp" }).hits).toEqual([]);
    expect(searchLines(db, OPTIONS, "ich", { limit: 1 })).toMatchObject({ more: true });
  });
});

describe("the content routes", () => {
  it("answer, with 404 for an unknown content", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    const app = await buildServer({ config: testConfig(), db, scheduler, webDistDir: tempDir() });
    const get = (url: string) => app.inject({ method: "GET", url, headers: { host: "127.0.0.1:7300" } });
    try {
      expect((await get("/api/contents")).json().contents).toHaveLength(2);
      expect((await get(`/api/contents/${encodeURIComponent("gsm:g")}`)).json().content.id).toBe("gsm:g");
      expect((await get("/api/contents/nope")).statusCode).toBe(404);
      expect((await get(`/api/search?q=${encodeURIComponent("Glück")}`)).json().hits).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
