import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGsmConnector } from "../src/connectors/gsm/connector.ts";
import {
  GsmSourceError,
  defaultGsmDataDir,
  locateGsm,
  openGsmReadOnly,
  readGsmStatsSettings,
  resolveGsmDataDir,
} from "../src/connectors/gsm/source.ts";
import { getConnectorState } from "../src/connectors/state.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { gsmDailyRollup, readingSecondsPerDay } from "../src/metrics/reading.ts";
import { createScheduler } from "../src/scheduler.ts";
import { FakeGsm, type LineInput } from "./fake-gsm.ts";
import { silentLogger, tempDir } from "./helpers.ts";

/** 2026-11-10 13:00 in Buenos Aires. */
const T = 1_794_326_400;
const GAME = "game-a";
// 13 characters once punctuation and spaces are gone; at 10 s per line that is 1.3 characters per second
const TEXT = "Ein kurzer Satz.";

const line = (id: string, offset: number, extra: Partial<LineInput> = {}): LineInput => ({
  id,
  gameId: GAME,
  gameName: "Beispiel Spiel",
  text: TEXT,
  timestamp: T + offset,
  ...extra,
});

let db: Database;

function setup() {
  db = openDatabase(":memory:");
  applyMigrations(db);
  const gsm = new FakeGsm(tempDir());
  gsm.addGame(GAME, "Beispiel Spiel");
  gsm.addLines([
    // First session; the break between a3 and a4 is not credited
    ...["a1", "a2", "a3", "a4", "a5", "a6"].map((id, index) => line(id, index * 10)),
    // An hour later: a second session, mostly German
    line("a7", 3650, { language: "ja" }),
    line("a8", 3660),
    line("a9", 3670),
    // A scene GSM linked to no game
    line("n1", 100, { gameId: "", gameName: "Browser - YouTube", language: "ja" }),
    line("n2", 110, { gameId: "", gameName: "Browser - YouTube", language: "ja" }),
  ]);
  gsm.addBreak(T + 25);

  let clock = 1_794_600_000_000;
  const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now: () => clock });
  scheduler.register(
    createGsmConnector({
      db,
      locate: () => ({ dbPath: gsm.dbPath, dataDir: gsm.dataDir }),
      attribution: { refoldDecks: [] },
      timeZone: "America/Buenos_Aires",
    }),
  );
  return {
    gsm,
    sync: async () => {
      clock += 60_000;
      return scheduler.run("gsm");
    },
  };
}

const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;

function addAnkiNote(noteId: number, tags: string[], miscInfo: string) {
  db.prepare(
    `INSERT INTO raw_anki_notes (note_id, model, deck, fields, tags, mod, payload, synced_at)
     VALUES (?, 'Kiku', 'German Mining', ?, ?, 0, '{}', 0)`,
  ).run(noteId, JSON.stringify({ Expression: "Satz", MiscInfo: miscInfo }), JSON.stringify(tags));
}

describe("the GSM connector", () => {
  afterEach(() => db.close());

  it("turns GSM's lines into contents, sessions and lines with their reading time", async () => {
    const { sync } = setup();
    expect(await sync()).toEqual({
      source: "gsm",
      ok: true,
      summary: {
        lines: 11,
        linesUpdated: 11,
        linesRemoved: 0,
        sessions: 3,
        readingSeconds: 70,
        cardsFromGsm: 0,
        rebuilt: true,
      },
    });

    expect(db.prepare("SELECT id, kind, title, external_id FROM contents ORDER BY id").all()).toEqual([
      { id: "gsm-name:Browser - YouTube", kind: "game", title: "Browser - YouTube", external_id: null },
      { id: `gsm:${GAME}`, kind: "game", title: "Beispiel Spiel", external_id: GAME },
    ]);
    expect(
      db
        .prepare("SELECT id, content_id, language, lines, seconds, units FROM sessions ORDER BY start_ts")
        .all(),
    ).toEqual([
      { id: "gsm:a1", content_id: `gsm:${GAME}`, language: "de", lines: 6, seconds: 40, units: 78 },
      {
        id: "gsm:n1",
        content_id: "gsm-name:Browser - YouTube",
        language: "ja",
        lines: 2,
        seconds: 10,
        units: 26,
      },
      // The most frequent language of the session wins
      { id: "gsm:a7", content_id: `gsm:${GAME}`, language: "de", lines: 3, seconds: 20, units: 39 },
    ]);
    // Each line keeps the time credited to it: nothing for the one before the break, nor for the last
    expect(
      (
        db.prepare("SELECT id, seconds FROM lines WHERE session_id = 'gsm:a1' ORDER BY ts").all() as {
          id: string;
          seconds: number;
        }[]
      ).map((row) => row.seconds),
    ).toEqual([10, 10, 0, 10, 10, 0]);
    expect(db.prepare("SELECT ts, chars, text FROM lines WHERE id = 'gsm:a1'").get()).toEqual({
      ts: T * 1000,
      chars: 13,
      text: TEXT,
    });

    // The sentence search finds words, and parts of words
    expect(count("SELECT COUNT(*) AS count FROM lines_fts WHERE lines_fts MATCH 'kurzer'")).toBe(11);
    expect(count("SELECT COUNT(*) AS count FROM lines_fts WHERE lines_fts MATCH 'urze'")).toBe(11);
  });

  it("never changes gsm.db, nor creates files next to it", async () => {
    const { gsm, sync } = setup();
    const before = gsm.fingerprint();
    await sync();
    await sync();
    expect(gsm.fingerprint()).toBe(before);
    expect(gsm.companions()).toEqual({ wal: false, shm: false });
  });

  it("does nothing new when run again", async () => {
    const { sync } = setup();
    await sync();
    expect(await sync()).toMatchObject({
      ok: true,
      summary: {
        lines: 11,
        linesUpdated: 0,
        linesRemoved: 0,
        sessions: 3,
        readingSeconds: 70,
        rebuilt: false,
      },
    });
    expect(count("SELECT COUNT(*) AS count FROM raw_gsm_lines")).toBe(11);
  });

  it("picks up a card mined from a line, and gives the card that line as its origin", async () => {
    const { gsm, sync } = setup();
    addAnkiNote(1787000000000, [], "Beispiel Spiel");
    addAnkiNote(1787000000001, ["GSM", "Game::Beispiel"], "Beispiel Spiel");
    addAnkiNote(1787000000002, [], "Ein Video");
    await sync();
    gsm.mineFrom("a3", 1787000000000, T + 5000);

    expect(await sync()).toMatchObject({ summary: { linesUpdated: 1, cardsFromGsm: 2, rebuilt: true } });
    expect(
      db.prepare("SELECT note_id, origin, content_id, line_id FROM cards ORDER BY note_id").all(),
    ).toEqual([
      { note_id: 1787000000000, origin: "gsm", content_id: `gsm:${GAME}`, line_id: "gsm:a3" },
      // No note_ids, but GSM's tag and the game's title in MiscInfo
      { note_id: 1787000000001, origin: "gsm", content_id: `gsm:${GAME}`, line_id: null },
      { note_id: 1787000000002, origin: "unknown", content_id: null, line_id: null },
    ]);
    expect(db.prepare("SELECT note_ids FROM lines WHERE id = 'gsm:a3'").get()).toEqual({
      note_ids: "[1787000000000]",
    });
  });

  it("drops a line deleted in GSM, but keeps the lines of a day GSM archived", async () => {
    const { gsm, sync } = setup();
    await sync();
    gsm.deleteLine("a9");
    expect(await sync()).toMatchObject({ summary: { lines: 10, linesRemoved: 1, readingSeconds: 60 } });
    expect(db.prepare("SELECT removed_at FROM raw_gsm_lines WHERE id = 'a9'").get()).toEqual({
      removed_at: expect.any(Number),
    });

    gsm.deleteLine("a1");
    gsm.archiveDay(GAME, "2026-11-10", "Beispiel Spiel");
    expect(await sync()).toMatchObject({ summary: { lines: 10, linesRemoved: 0 } });
  });

  it("reads what a running GSM has not checkpointed yet", async () => {
    const { gsm, sync } = setup();
    await sync();
    const writer = gsm.openWriter();
    try {
      FakeGsm.insertLine(writer, line("a10", 3680));
      expect(gsm.companions()).toEqual({ wal: true, shm: true });
      expect(await sync()).toMatchObject({ summary: { lines: 12, linesUpdated: 1, readingSeconds: 80 } });
    } finally {
      writer.close();
    }
  });

  it("counts with the user's GSM settings, and recounts when they change", async () => {
    const { gsm, sync } = setup();
    await sync();
    // With a 5-second session gap, every 10-second gap ends a session: nothing is credited
    gsm.writeConfig({ session_gap_seconds: 5 });
    expect(await sync()).toMatchObject({
      summary: { linesUpdated: 0, sessions: 11, readingSeconds: 0, rebuilt: true },
    });
    expect(getConnectorState(db, "gsm")?.cursor).toEqual({
      settings: { sessionGapSeconds: 5, regexOutRepetitions: false, extraPunctuationRegex: "" },
    });
  });

  it("recounts when a reading break is added", async () => {
    const { gsm, sync } = setup();
    await sync();
    gsm.addBreak(T + 3655);
    expect(await sync()).toMatchObject({ summary: { linesUpdated: 0, readingSeconds: 60, rebuilt: true } });
  });

  it("adds up a day like GSM's rollup, and like Mosaik's own lines", async () => {
    const { sync } = setup();
    await sync();
    const tz = "America/Buenos_Aires";
    // GSM's procedure leaves out the lines without a game
    expect(Object.fromEntries(gsmDailyRollup(db, { timeZone: tz, sessionGapSeconds: 1800 }))).toEqual({
      [`2026-11-10|${GAME}`]: { seconds: 60, chars: 117, lines: 9 },
    });
    expect(Object.fromEntries(readingSecondsPerDay(db, { timeZone: tz, cutoffHour: 4 }))).toEqual({
      [`2026-11-10|gsm:${GAME}`]: 60,
      "2026-11-10|gsm-name:Browser - YouTube": 10,
    });
  });

  it("records that GSM's database is missing without touching anything", async () => {
    db = openDatabase(":memory:");
    applyMigrations(db);
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
    scheduler.register(
      createGsmConnector({
        db,
        locate: () => ({ dbPath: join(tempDir(), "gsm.db"), dataDir: tempDir() }),
        attribution: { refoldDecks: [] },
        timeZone: "America/Buenos_Aires",
      }),
    );
    expect(await scheduler.run("gsm")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not found/),
    });
    expect(count("SELECT COUNT(*) AS count FROM raw_gsm_lines")).toBe(0);
  });
});

describe("finding GSM", () => {
  it("uses GSM's default folder, or the one data_dir.json points to", () => {
    const home = tempDir();
    const appData = join(home, "AppData", "Roaming");
    const env = { APPDATA: appData };
    expect(defaultGsmDataDir(env, "win32", home)).toBe(join(appData, "GameSentenceMiner"));
    expect(defaultGsmDataDir({}, "linux", home)).toBe(join(home, ".config", "GameSentenceMiner"));
    expect(resolveGsmDataDir(env, "win32", home)).toBe(join(appData, "GameSentenceMiner"));

    // The older pointer, in the default folder
    const legacyTarget = join(home, "Legacy");
    mkdirSync(join(appData, "GameSentenceMiner"), { recursive: true });
    writeFileSync(
      join(appData, "GameSentenceMiner", "data_dir.json"),
      JSON.stringify({ dataDir: legacyTarget }),
    );
    expect(resolveGsmDataDir(env, "win32", home)).toBe(legacyTarget);

    // The current pointer wins; a relative path is not one
    const pointerDir = join(home, ".config", "GameSentenceMiner");
    mkdirSync(pointerDir, { recursive: true });
    writeFileSync(join(pointerDir, "data_dir.json"), JSON.stringify({ dataDir: "relative/dir" }));
    expect(resolveGsmDataDir(env, "win32", home)).toBe(legacyTarget);
    const target = join(home, "D", "GSM data");
    writeFileSync(join(pointerDir, "data_dir.json"), JSON.stringify({ dataDir: target }));
    expect(resolveGsmDataDir(env, "win32", home)).toBe(target);
  });

  it("takes GSM_DB_PATH as it is", () => {
    const path = join(tempDir(), "elsewhere", "gsm.db");
    expect(locateGsm(path)).toEqual({ dbPath: path, dataDir: join(path, "..") });
  });

  it("reads GSM's statistics settings, with defaults for what is missing or wrong", () => {
    const gsm = new FakeGsm(tempDir());
    expect(readGsmStatsSettings(gsm.dataDir)).toEqual({
      sessionGapSeconds: 1800,
      regexOutRepetitions: false,
      extraPunctuationRegex: "",
    });
    gsm.writeConfig({ session_gap_seconds: 900, regex_out_repetitions: true, extra_punctuation_regex: "~" });
    expect(readGsmStatsSettings(gsm.dataDir)).toEqual({
      sessionGapSeconds: 900,
      regexOutRepetitions: true,
      extraPunctuationRegex: "~",
    });
    gsm.writeConfig({ session_gap_seconds: -1 });
    expect(readGsmStatsSettings(gsm.dataDir).sessionGapSeconds).toBe(1800);
  });

  it("says clearly when there is no database", () => {
    expect(() => openGsmReadOnly(join(tempDir(), "gsm.db"))).toThrow(GsmSourceError);
  });
});
