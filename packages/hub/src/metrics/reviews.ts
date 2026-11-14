/** Review metrics over the common `reviews` table. */
import { dayKey } from "@mosaik/shared";
import type { Database } from "../db/database.ts";

/**
 * The review types that count as a review, as in Anki's statistics: learning (0), review (1),
 * relearning (2) and filtered (3). Manual entries (4) and reschedules (5), such as the ones FSRS
 * writes when it reschedules every card, have no answer and are not reviews.
 */
export const COUNTED_REVIEW_TYPES = [0, 1, 2, 3] as const;

/** Reviews per day (`YYYY-MM-DD` → count), with the user's time zone and cutoff hour. */
export function reviewsPerDay(db: Database, timeZone: string, cutoffHour: number): Map<string, number> {
  const rows = db
    .prepare(`SELECT ts FROM reviews WHERE type IN (${COUNTED_REVIEW_TYPES.join(", ")}) ORDER BY ts`)
    .all() as { ts: number }[];
  const counts = new Map<string, number>();
  for (const { ts } of rows) {
    const day = dayKey(ts, timeZone, cutoffHour);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

export interface DayComparison {
  day: string;
  mosaik: number;
  anki: number;
}

/** The days where Mosaik and Anki do not count the same number of reviews. */
export function compareReviewsPerDay(
  mosaik: Map<string, number>,
  anki: Iterable<[string, number]>,
): DayComparison[] {
  const theirs = new Map(anki);
  const days = [...new Set([...mosaik.keys(), ...theirs.keys()])].sort();
  return days
    .map((day) => ({ day, mosaik: mosaik.get(day) ?? 0, anki: theirs.get(day) ?? 0 }))
    .filter((row) => row.mosaik !== row.anki);
}
