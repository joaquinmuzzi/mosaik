/**
 * Mosaik's data as files the user downloads: CSV tables (days, contents, cards) and a full copy of
 * the database. They are only served to this computer, like the rest of the API.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dayKey } from "@mosaik/shared";
import type { Database } from "../db/database.ts";
import { listContents } from "./contents.ts";
import type { DashboardOptions } from "./dashboard.ts";
import { allDays } from "./stats.ts";

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (a video title starting with "=")
 * gets a leading apostrophe, so opening the file never runs anything.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Byte order mark: with it, Excel reads the file as UTF-8 (accents, umlauts). */
export const BOM = String.fromCharCode(0xfeff);

/** A CSV with a BOM, so Excel reads the accents and umlauts right. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return `${BOM}${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

const round = (seconds: number) => Math.round(seconds);

export function daysCsv(db: Database, options: DashboardOptions, now = Date.now()): string {
  return toCsv(
    [
      "day",
      "gsm_seconds",
      "deuchan_seconds",
      "immersion_seconds",
      "reviews",
      "review_seconds",
      "cards_mined",
    ],
    allDays(db, options, now).map((day) => [
      day.day,
      round(day.gsmSeconds),
      day.deuchanSeconds === null ? null : round(day.deuchanSeconds),
      round(day.gsmSeconds + (day.deuchanSeconds ?? 0)),
      day.reviews,
      round(day.reviewSeconds),
      day.cardsMined,
    ]),
  );
}

export function contentsCsv(db: Database, options: DashboardOptions): string {
  return toCsv(
    [
      "id",
      "source",
      "kind",
      "title",
      "seconds",
      "sessions",
      "words",
      "characters",
      "cards_mined",
      "first_day",
      "last_day",
    ],
    listContents(db, options).contents.map((content) => [
      content.id,
      content.source,
      content.kind,
      content.title,
      round(content.seconds),
      content.sessions,
      content.words,
      content.characters,
      content.cardsMined,
      content.firstDay,
      content.lastDay,
    ]),
  );
}

export function cardsCsv(db: Database, options: DashboardOptions): string {
  const rows = db
    .prepare(
      `SELECT c.note_id, c.word, c.origin, c.deck, c.content_id, co.title, c.source_title, c.created_ts
       FROM cards c LEFT JOIN contents co ON co.id = c.content_id ORDER BY c.created_ts, c.note_id`,
    )
    .all() as {
    note_id: number;
    word: string | null;
    origin: string;
    deck: string;
    content_id: string | null;
    title: string | null;
    source_title: string | null;
    created_ts: number;
  }[];
  return toCsv(
    ["note_id", "word", "origin", "deck", "content_id", "content_title", "source_title", "created_day"],
    rows.map((row) => [
      row.note_id,
      row.word,
      row.origin,
      row.deck,
      row.content_id,
      row.title,
      row.source_title,
      dayKey(row.created_ts, options.timeZone, options.cutoffHour),
    ]),
  );
}

/**
 * A consistent copy of the whole database (`VACUUM INTO`), taken while the hub keeps running. It is
 * written to a temporary folder, read and deleted.
 */
export function backupDatabase(db: Database): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "mosaik-backup-"));
  try {
    const path = join(dir, "mosaik.sqlite");
    db.prepare("VACUUM INTO ?").run(path);
    return readFileSync(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
