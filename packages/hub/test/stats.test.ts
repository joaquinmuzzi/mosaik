import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StatsResponse } from "@mosaik/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOM, backupDatabase, cardsCsv, contentsCsv, daysCsv, toCsv } from "../src/api/export.ts";
import { allDays, longestRun, stats } from "../src/api/stats.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const OPTIONS = { timeZone: "America/Buenos_Aires", cutoffHour: 4, targetLanguage: "de" };
const local = (day: string, time: string) => Date.parse(`${day}T${time}:00-03:00`);
const NOW = local("2026-11-14", "12:00");

let db: Database | undefined;

function seed(): Database {
  const database = openDatabase(":memory:");
  applyMigrations(database);
  const run = (sql: string, ...values: (string | number | null)[]) => database.prepare(sql).run(...values);
  run(
    `INSERT INTO contents (id, source, kind, title, external_id) VALUES
     ('gsm:g', 'gsm', 'game', 'Beispiel Spiel', 'g'),
     ('yt:aaaaaaaaaaa', 'deuchan', 'video', '=Formel, "zitiert"', 'aaaaaaaaaaa')`,
  );
  // The game: one session a day on the 10th, 11th and 12th (900 s, 600 s, 300 s)
  const days = [
    ["2026-11-10", 900],
    ["2026-11-11", 600],
    ["2026-11-12", 300],
  ] as const;
  for (const [day, seconds] of days) {
    run(
      `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds, units, unit, lines)
       VALUES (?, 'gsm', 'game', 'de', 'gsm:g', ?, ?, ?, 50, 'characters', 1)`,
      `gsm:${day}`,
      local(day, "20:00"),
      local(day, "21:00"),
      seconds,
    );
    run(
      `INSERT INTO lines (id, source, content_id, session_id, ts, text, chars, seconds) VALUES (?, 'gsm', 'gsm:g', ?, ?, 'Satz', 50, ?)`,
      `gsm:l:${day}`,
      `gsm:${day}`,
      local(day, "20:00"),
      seconds,
    );
  }
  // The video: Deuchan credited it 2000 s on the 12th and 100 s on the 13th
  for (const [day, at, seconds] of [
    ["2026-11-12", 1, 2000],
    ["2026-11-13", 2, 100],
  ] as const) {
    run(
      `INSERT INTO raw_events (id, source, kind, received_at, payload) VALUES (?, 'deuchan', 'day_total', 0, ?)`,
      `d:${day}`,
      JSON.stringify({ day, at, seconds, videos: [{ videoId: "aaaaaaaaaaa", seconds }] }),
    );
    run(
      `INSERT INTO day_totals (source, device, day, seconds, at, event_id) VALUES ('deuchan', 'principal', ?, ?, ?, ?)`,
      day,
      seconds,
      at,
      `d:${day}`,
    );
  }
  run(
    `INSERT INTO cards (note_id, word, deck, model, origin, content_id, created_ts) VALUES
     (1, 'Glück', 'Mining', 'Kiku', 'gsm', 'gsm:g', ?),
     (2, 'Wort', 'Mining', 'Kiku', 'gsm', 'gsm:g', ?),
     (3, 'Haus', 'Refold', 'Basic', 'refold-1k', NULL, ?)`,
    local("2026-11-11", "20:30"),
    local("2026-11-12", "20:30"),
    local("2026-11-08", "10:00"),
  );
  // A review on the 8th: Anki alone starts the history (the Refold card does not count as mined)
  run(
    "INSERT INTO reviews (review_id, note_id, card_id, ts, ease, ivl, last_ivl, type, time_ms) VALUES (1, 3, 3, ?, 3, 1, 0, 1, 8000)",
    local("2026-11-08", "10:05"),
  );
  return database;
}

beforeEach(() => {
  db = seed();
});

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("longestRun", () => {
  it("finds the longest run of consecutive days, the most recent on a tie", () => {
    expect(longestRun([])).toBeNull();
    expect(longestRun(["2026-11-03", "2026-11-01", "2026-11-02", "2026-11-05"])).toEqual({
      days: 3,
      from: "2026-11-01",
      to: "2026-11-03",
    });
    expect(longestRun(["2026-01-01", "2026-01-03"])).toEqual({
      days: 1,
      from: "2026-01-03",
      to: "2026-01-03",
    });
    // Across a month boundary
    expect(longestRun(["2026-10-31", "2026-11-01"])?.days).toBe(2);
  });
});

describe("allDays", () => {
  it("goes from the first day with anything (a review counts) to today", () => {
    const days = allDays(db!, OPTIONS, NOW);
    expect(days[0]?.day).toBe("2026-11-08");
    expect(days.at(-1)?.day).toBe("2026-11-14");
    expect(days).toHaveLength(7);
  });
});

describe("stats", () => {
  it("picks the highlights over the whole history", () => {
    const { highlights, today } = stats(db!, OPTIONS, NOW);
    expect(today).toBe("2026-11-14");
    expect(highlights.mostTime).toEqual({
      id: "yt:aaaaaaaaaaa",
      title: '=Formel, "zitiert"',
      kind: "video",
      value: 2100,
    });
    expect(highlights.mostSessions).toMatchObject({ id: "gsm:g", value: 3 });
    expect(highlights.mostCharacters).toMatchObject({ id: "gsm:g", value: 150 });
    // The Refold card has no content, so the game leads with its two
    expect(highlights.mostMined).toMatchObject({ id: "gsm:g", value: 2 });
    expect(highlights.biggestDay).toEqual({ day: "2026-11-12", seconds: 2300 });
    expect(highlights.longestStreak).toEqual({ days: 4, from: "2026-11-10", to: "2026-11-13" });
    expect(highlights.longestTitleStreak).toEqual({
      days: 3,
      from: "2026-11-10",
      to: "2026-11-12",
      id: "gsm:g",
      title: "Beispiel Spiel",
      kind: "game",
    });
  });

  it("has no highlights without data", () => {
    const empty = openDatabase(":memory:");
    applyMigrations(empty);
    const result = stats(empty, OPTIONS, NOW);
    empty.close();
    expect(result.days.map((day) => day.day)).toEqual(["2026-11-14"]);
    expect(Object.values(result.highlights).every((value) => value === null)).toBe(true);
  });
});

describe("CSV export", () => {
  it("quotes cells and keeps formulas from running", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x,y", '=SUM(1) "q"'],
          [null, 3],
        ],
      ),
    ).toBe(BOM + 'a,b\r\n"x,y","\'=SUM(1) ""q"""\r\n,3\r\n');
  });

  it("writes the days, with an empty cell where Deuchan sent nothing", () => {
    const lines = daysCsv(db!, OPTIONS, NOW).replace(BOM, "").trim().split("\r\n");
    expect(lines[0]).toBe(
      "day,gsm_seconds,deuchan_seconds,immersion_seconds,reviews,review_seconds,cards_mined",
    );
    expect(lines).toContain("2026-11-10,900,,900,0,0,0");
    expect(lines).toContain("2026-11-12,300,2000,2300,0,0,1");
    expect(lines).toContain("2026-11-08,0,,0,1,8,0");
    expect(lines).toHaveLength(8);
  });

  it("writes the contents and the cards", () => {
    const contents = contentsCsv(db!, OPTIONS);
    expect(contents).toContain(
      `yt:aaaaaaaaaaa,deuchan,video,"'=Formel, ""zitiert""",2100,0,,0,2026-11-12,2026-11-13`,
    );
    const cards = cardsCsv(db!, OPTIONS);
    expect(cards).toContain("1,Glück,gsm,Mining,gsm:g,Beispiel Spiel,,2026-11-11");
    expect(cards).toContain("3,Haus,refold-1k,Refold,,,,2026-11-08");
  });
});

describe("backupDatabase", () => {
  it("copies the whole database into a file that opens on its own", () => {
    const data = backupDatabase(db!);
    expect(data.subarray(0, 16).toString("latin1")).toBe("SQLite format 3\0");
    const path = join(tempDir(), "copy.sqlite");
    writeFileSync(path, data);
    const copy = openDatabase(path);
    const count = copy.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
    copy.close();
    expect(count.n).toBe(3);
  });
});

describe("routes", () => {
  it("serves the stats and the downloads", async () => {
    const scheduler = createScheduler({ db: db!, intervalMs: 60_000, log: silentLogger });
    const app = await buildServer({
      config: testConfig({ timeZone: OPTIONS.timeZone }),
      db: db!,
      scheduler,
      webDistDir: join(tempDir(), "missing"),
    });
    try {
      const headers = { host: "127.0.0.1:7300" };
      const statsResponse = await app.inject({ method: "GET", url: "/api/stats", headers });
      expect(statsResponse.statusCode).toBe(200);
      expect(statsResponse.json<StatsResponse>().highlights.mostSessions?.id).toBe("gsm:g");

      const csv = await app.inject({ method: "GET", url: "/api/export/days.csv", headers });
      expect(csv.statusCode).toBe(200);
      expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(csv.headers["content-disposition"]).toMatch(
        /^attachment; filename="mosaik-dias-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(csv.headers["cache-control"]).toBe("no-store");

      const backup = await app.inject({ method: "GET", url: "/api/export/backup", headers });
      expect(backup.statusCode).toBe(200);
      expect(backup.headers["content-disposition"]).toMatch(/mosaik-backup-.*\.sqlite"$/);
      expect(backup.rawPayload.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");

      const foreign = await app.inject({
        method: "GET",
        url: "/api/export/backup",
        headers: { host: "evil.example" },
      });
      expect(foreign.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
