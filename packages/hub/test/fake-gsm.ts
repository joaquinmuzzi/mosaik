/**
 * A synthetic GameSentenceMiner data folder for tests: a `gsm.db` with GSM's schema (2026.11, the
 * tables Mosaik reads), in WAL mode like GSM's, and an optional `config.json`.
 *
 * Every change opens the database, writes and closes it, which leaves no `-wal`/`-shm` files, as when
 * GSM is closed. `openWriter` keeps a connection open, as when GSM is running.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE game_lines (id TEXT PRIMARY KEY, game_name TEXT, line_text TEXT, screenshot_in_anki TEXT,
    audio_in_anki TEXT, screenshot_path TEXT, audio_path TEXT, replay_path TEXT, translation TEXT, language TEXT,
    original_game_name TEXT, game_id TEXT, note_ids TEXT, last_modified TEXT, created_at TEXT, timestamp REAL,
    tokenized INTEGER DEFAULT 0);
  CREATE TABLE games (id TEXT PRIMARY KEY, deck_id TEXT, title_original TEXT, title_romaji TEXT, title_english TEXT,
    type TEXT, description TEXT, image TEXT, character_count TEXT, difficulty TEXT, links TEXT, completed TEXT,
    release_date TEXT, manual_overrides TEXT, obs_scene_name TEXT, genres TEXT, tags TEXT, vndb_character_data TEXT,
    character_summary TEXT, vndb_id TEXT, anilist_id TEXT, status TEXT);
  CREATE TABLE game_daily_rollup (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, game_id TEXT,
    total_characters TEXT, total_lines TEXT, total_cards_mined TEXT, total_reading_time_seconds TEXT,
    created_at TEXT, updated_at TEXT);
  CREATE TABLE stats_reading_breaks (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT);
  CREATE TABLE archived_game_days (game_id TEXT NOT NULL, date TEXT NOT NULL, game_name TEXT NOT NULL,
    events BLOB NOT NULL, kanji TEXT NOT NULL, raw_kanji TEXT NOT NULL, archived_at REAL NOT NULL,
    line_count INTEGER NOT NULL, character_count INTEGER NOT NULL, first_timestamp REAL NOT NULL,
    last_timestamp REAL NOT NULL, tokenized_lines INTEGER NOT NULL, token_kanji TEXT NOT NULL,
    PRIMARY KEY (game_id, date));
`;

export interface LineInput {
  id: string;
  gameId: string;
  gameName: string;
  text: string;
  /** Epoch seconds. */
  timestamp: number;
  language?: string;
  noteIds?: string[];
}

export class FakeGsm {
  readonly dataDir: string;
  readonly dbPath: string;

  constructor(dir: string) {
    this.dataDir = join(dir, "GameSentenceMiner");
    mkdirSync(this.dataDir, { recursive: true });
    this.dbPath = join(this.dataDir, "gsm.db");
    this.write((db) => {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec(SCHEMA);
    });
  }

  /** Opens, changes and closes the database, as a GSM that is not running leaves it. */
  write(change: (db: DatabaseSync) => void): void {
    const db = new DatabaseSync(this.dbPath);
    try {
      change(db);
    } finally {
      db.close();
    }
  }

  /** A connection that stays open with checkpoints off, as GSM keeps one while it runs. */
  openWriter(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA wal_autocheckpoint = 0");
    return db;
  }

  static insertLine(db: DatabaseSync, line: LineInput): void {
    db.prepare(
      `INSERT INTO game_lines (id, game_name, line_text, language, game_id, note_ids, last_modified, created_at, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      line.id,
      line.gameName,
      line.text,
      line.language ?? "de",
      line.gameId,
      line.noteIds ? JSON.stringify(line.noteIds) : null,
      String(line.timestamp),
      String(line.timestamp),
      line.timestamp,
    );
  }

  addLines(lines: LineInput[]): void {
    this.write((db) => {
      for (const line of lines) FakeGsm.insertLine(db, line);
    });
  }

  addGame(id: string, title: string): void {
    this.write((db) =>
      db
        .prepare(
          "INSERT INTO games (id, title_original, title_english, type, character_count, completed, obs_scene_name, image) VALUES (?, ?, '', '', '0', '0', ?, ?)",
        )
        .run(id, title, title, "data:image/png;base64,AAAA"),
    );
  }

  /** What GSM does when a card is mined from a line: fills note_ids and bumps last_modified. */
  mineFrom(lineId: string, noteId: number, modified: number): void {
    this.write((db) =>
      db
        .prepare("UPDATE game_lines SET note_ids = ?, last_modified = ? WHERE id = ?")
        .run(JSON.stringify([String(noteId)]), String(modified), lineId),
    );
  }

  deleteLine(lineId: string): void {
    this.write((db) => db.prepare("DELETE FROM game_lines WHERE id = ?").run(lineId));
  }

  archiveDay(gameId: string, date: string, gameName: string): void {
    this.write((db) =>
      db
        .prepare(
          `INSERT INTO archived_game_days (game_id, date, game_name, events, kanji, raw_kanji, archived_at,
             line_count, character_count, first_timestamp, last_timestamp, tokenized_lines, token_kanji)
           VALUES (?, ?, ?, x'00', '{}', '{}', 0, 0, 0, 0, 0, 0, '{}')`,
        )
        .run(gameId, date, gameName),
    );
  }

  addBreak(timestamp: number): void {
    this.write((db) =>
      db.prepare("INSERT INTO stats_reading_breaks (timestamp) VALUES (?)").run(String(timestamp)),
    );
  }

  writeConfig(stats: Record<string, unknown>): void {
    writeFileSync(join(this.dataDir, "config.json"), JSON.stringify({ configs: {}, stats }));
  }

  /** Whether the database's companion files exist. */
  companions(): { wal: boolean; shm: boolean } {
    return { wal: existsSync(`${this.dbPath}-wal`), shm: existsSync(`${this.dbPath}-shm`) };
  }

  fingerprint(): string {
    const stat = statSync(this.dbPath);
    return `${stat.size}:${stat.mtimeMs}`;
  }
}
