/**
 * `GET /api/agent/deuchan/days`: what every Deuchan device sent for a range of days, so that each
 * Deuchan can show the total of all of them. Answered with a device token, like the rest of
 * `/api/agent/*`.
 */
import type { Database } from "../db/database.ts";
import { snapshotItemsByDay } from "../derive/deuchan.ts";

/** Deuchan keeps 60 days of videos; a year of totals is plenty for its charts. */
export const MAX_DEUCHAN_DAYS = 400;

export interface DeuchanDaysResponse {
  days: Record<
    string,
    {
      seconds: number;
      readingSeconds: number;
      devices: Record<string, number>;
      items: {
        id: string;
        title: string | null;
        url: string | null;
        contentKind: "video" | "reading";
        seconds: number;
        /** Its seconds on each device. */
        devices: Record<string, number>;
      }[];
    }
  >;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayRange(query: {
  from?: unknown;
  to?: unknown;
}): { from: string; to: string } | { error: string } {
  const { from, to } = query;
  if (typeof from !== "string" || typeof to !== "string" || !DAY.test(from) || !DAY.test(to)) {
    return { error: "from and to must be days like 2026-11-18" };
  }
  if (from > to) return { error: "from must not be after to" };
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_DEUCHAN_DAYS) return { error: `at most ${MAX_DEUCHAN_DAYS} days` };
  return { from, to };
}

export function deuchanDays(db: Database, range: { from: string; to: string }): DeuchanDaysResponse {
  const days: DeuchanDaysResponse["days"] = {};
  for (const row of db
    .prepare(
      `SELECT day, device, seconds, reading_seconds FROM day_totals
       WHERE source = 'deuchan' AND day BETWEEN ? AND ? ORDER BY day, device`,
    )
    .all(range.from, range.to) as {
    day: string;
    device: string;
    seconds: number;
    reading_seconds: number;
  }[]) {
    const entry = (days[row.day] ??= { seconds: 0, readingSeconds: 0, devices: {}, items: [] });
    entry.seconds += row.seconds;
    entry.readingSeconds += row.reading_seconds;
    entry.devices[row.device] = row.seconds;
  }
  for (const [day, items] of snapshotItemsByDay(db, range)) {
    const entry = days[day];
    if (!entry) continue;
    entry.items = items.map((item) => ({
      id: item.contentId,
      title: item.title,
      url: item.url,
      contentKind: item.contentKind,
      seconds: item.seconds,
      devices: item.secondsByDevice,
    }));
  }
  return { days };
}
