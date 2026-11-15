/**
 * Totals per week, month or year, and the rhythm of the week (which days you do more), built from
 * the days the hub sends. Nothing here counts time on its own: it only adds the API's days up.
 */
import type { DaySummary } from "@mosaik/shared";
import { immersion, mondayOf } from "./data";

export type PeriodKind = "week" | "month" | "year";

export interface PeriodRow {
  /** Monday of the week, `2026-11`, or `2026`. */
  key: string;
  gsmSeconds: number;
  deuchanSeconds: number;
  immersion: number;
  /** Days with any immersion. */
  activeDays: number;
  reviews: number;
  cardsMined: number;
  /** Immersion minus the period before, or null for the oldest one. */
  change: number | null;
  /** The period today is in: it has not ended yet. */
  current: boolean;
}

export function periodKey(day: string, kind: PeriodKind): string {
  if (kind === "week") return mondayOf(day);
  return kind === "month" ? day.slice(0, 7) : day.slice(0, 4);
}

/** The newest `count` periods, newest first. `days` go oldest first and end today. */
export function periodRows(days: DaySummary[], kind: PeriodKind, count = 12): PeriodRow[] {
  const rows = new Map<string, PeriodRow>();
  for (const day of days) {
    const key = periodKey(day.day, kind);
    const row = rows.get(key) ?? {
      key,
      gsmSeconds: 0,
      deuchanSeconds: 0,
      immersion: 0,
      activeDays: 0,
      reviews: 0,
      cardsMined: 0,
      change: null,
      current: false,
    };
    row.gsmSeconds += day.gsmSeconds;
    row.deuchanSeconds += day.deuchanSeconds ?? 0;
    row.immersion += immersion(day);
    row.activeDays += immersion(day) > 0 ? 1 : 0;
    row.reviews += day.reviews;
    row.cardsMined += day.cardsMined;
    rows.set(key, row);
  }
  const ordered = [...rows.values()];
  ordered.forEach((row, index) => {
    const previous = ordered[index - 1];
    row.change = previous ? row.immersion - previous.immersion : null;
  });
  const last = ordered.at(-1);
  if (last && days.length > 0) last.current = true;
  return ordered.slice(-count).reverse();
}

export interface WeekdayRhythm {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** How many of those days there were in the range (empty ones included). */
  count: number;
  /** Averages in seconds; game + video add up to the total. */
  averageGsm: number;
  averageDeuchan: number;
  average: number;
  median: number;
}

const median = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** Immersion per day of the week, Monday first. Empty days count: they are part of the rhythm. */
export function weekdayRhythm(days: DaySummary[]): WeekdayRhythm[] {
  const groups = Array.from({ length: 7 }, () => [] as DaySummary[]);
  for (const day of days) {
    const weekday = (new Date(`${day.day}T12:00:00Z`).getUTCDay() + 6) % 7;
    groups[weekday]!.push(day);
  }
  return groups.map((group, weekday) => {
    const count = group.length;
    const sum = (value: (day: DaySummary) => number) => group.reduce((total, day) => total + value(day), 0);
    const averageGsm = count ? sum((day) => day.gsmSeconds) / count : 0;
    const averageDeuchan = count ? sum((day) => day.deuchanSeconds ?? 0) / count : 0;
    return {
      weekday,
      count,
      averageGsm,
      averageDeuchan,
      average: averageGsm + averageDeuchan,
      median: median(group.map(immersion)),
    };
  });
}
