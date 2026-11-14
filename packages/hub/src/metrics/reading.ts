/** Reading-time metrics over the GSM copy and the common `lines` table. */
import { dayKey } from "@mosaik/shared";
import {
  type StatsTextOptions,
  actualReadingSeconds,
  cleanTextForStats,
  countCharacters,
} from "../connectors/gsm/reading-time.ts";
import type { Database } from "../db/database.ts";

export interface DayGameTotal {
  seconds: number;
  chars: number;
  lines: number;
}

/**
 * GSM's own daily rollup, recomputed from Mosaik's raw copy: lines grouped by local calendar day and
 * game, and each group's time computed on its own, as GSM's `daily_rollup.py` does. Lines without a
 * game are left out, as GSM leaves them out. Keys are `day|game_id`.
 */
export function gsmDailyRollup(
  db: Database,
  options: { timeZone: string; sessionGapSeconds: number; text?: StatsTextOptions },
): Map<string, DayGameTotal> {
  const breaks = (db.prepare("SELECT timestamp FROM raw_gsm_breaks").all() as { timestamp: number }[]).map(
    (row) => row.timestamp,
  );
  const rows = db
    .prepare(
      `SELECT game_id, timestamp, line_text FROM raw_gsm_lines
       WHERE removed_at IS NULL AND game_id IS NOT NULL AND TRIM(game_id) != ''`,
    )
    .all() as { game_id: string; timestamp: number; line_text: string | null }[];
  const groups = new Map<string, { timestamp: number; chars: number }[]>();
  for (const row of rows) {
    const key = `${dayKey(row.timestamp * 1000, options.timeZone, 0)}|${row.game_id}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push({
      timestamp: row.timestamp,
      chars: countCharacters(cleanTextForStats(row.line_text, options.text)),
    });
  }
  const totals = new Map<string, DayGameTotal>();
  for (const [key, group] of groups) {
    totals.set(key, {
      seconds: actualReadingSeconds(group, { sessionGapSeconds: options.sessionGapSeconds, breaks }),
      chars: group.reduce((sum, line) => sum + line.chars, 0),
      lines: group.length,
    });
  }
  return totals;
}

/**
 * Mosaik's reading time per day and content: the seconds credited to each line, added up by the day
 * the line was read, with the given cutoff hour. Keys are `day|content_id`.
 */
export function readingSecondsPerDay(
  db: Database,
  options: { timeZone: string; cutoffHour: number; source?: string },
): Map<string, number> {
  const rows = db
    .prepare("SELECT content_id, ts, seconds FROM lines WHERE source = ?")
    .all(options.source ?? "gsm") as { content_id: string | null; ts: number; seconds: number }[];
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${dayKey(row.ts, options.timeZone, options.cutoffHour)}|${row.content_id ?? ""}`;
    totals.set(key, (totals.get(key) ?? 0) + row.seconds);
  }
  return totals;
}
