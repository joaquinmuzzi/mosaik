import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { countWords } from "../words.ts";

export type Database = DatabaseSync;

/** Opens (and creates, with its folder) Mosaik's own database. `:memory:` is accepted for tests. */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  // WAL lets the dashboard read while a connector writes
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  // `word_count(text)`, for the queries that add up the words read
  db.function("word_count", { deterministic: true }, (text) =>
    typeof text === "string" ? countWords(text) : 0,
  );
  return db;
}

/** Runs `work` in a transaction: all of it is written, or none of it. */
export function transaction<T>(db: Database, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
