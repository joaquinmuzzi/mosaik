/**
 * The activity calendar, laid out as Anki's Review Heatmap: one block per month, its weeks as columns
 * from Monday to Sunday, a blank column between months. Pure functions; `ActivityCalendar.svelte` draws it.
 */
import { addDays } from "./format";

export interface CalendarDay {
  day: string;
  /** 0 is Monday. */
  weekday: number;
}

export interface CalendarMonth {
  /** `2026-11`. */
  month: string;
  /** The weeks the month touches; each holds only days of the month, in their weekday's place. */
  weeks: (CalendarDay | null)[][];
}

/** `2026-11` plus `n` months. */
export function addMonths(month: string, n: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** How many months there are from one to another; 0 for the same one. */
export function monthsBetween(from: string, to: string): number {
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return index(to) - index(from);
}

export function calendarMonth(month: string): CalendarMonth {
  const weeks: (CalendarDay | null)[][] = [];
  const first = `${month}-01`;
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  for (let index = 0; ; index += 1) {
    const day = addDays(first, index);
    if (!day.startsWith(month)) break;
    const place = index + offset;
    const week = Math.floor(place / 7);
    weeks[week] ??= Array<CalendarDay | null>(7).fill(null);
    weeks[week][place % 7] = { day, weekday: place % 7 };
  }
  return { month, weeks };
}

/** The months of a calendar, oldest first, ending with `last`. */
export const calendarMonths = (last: string, count: number): CalendarMonth[] =>
  Array.from({ length: count }, (_, index) => calendarMonth(addMonths(last, index - count + 1)));

/** The columns it takes: the weeks of each month, and the blank one between two months. */
export const calendarColumns = (months: CalendarMonth[]): number =>
  months.reduce((sum, month) => sum + month.weeks.length, 0) + Math.max(0, months.length - 1);

/** The width of a cell with its gap, in pixels. */
export const MIN_PITCH = 12;
export const MAX_PITCH = 18;

/**
 * What fits in `width` pixels: up to a year, with fewer months when the cells would be too small to
 * read or to touch, and the size that fills the width. The cells are always square. Nothing before
 * `first` is shown while there is room after `last`: a short history starts at the left and the months
 * to come follow it, as in Anki.
 */
export function fitCalendar(
  last: string,
  width: number,
  { first, max = 12, minPitch = MIN_PITCH }: { first?: string; max?: number; minPitch?: number } = {},
): { months: CalendarMonth[]; pitch: number } {
  const window = (count: number) => {
    const end = first === undefined ? last : addMonths(first, count - 1);
    return calendarMonths(end > last ? end : last, count);
  };
  let count = max;
  let months = window(count);
  while (count > 1 && width / calendarColumns(months) < minPitch) {
    count -= 1;
    months = window(count);
  }
  const pitch = Math.floor(width / calendarColumns(months));
  return { months, pitch: Math.max(6, Math.min(MAX_PITCH, pitch)) };
}

/** Where each level starts, as a multiple of the average of the active days (as in Review Heatmap). */
const STEPS = [0, 0.125, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
export const LEVELS = STEPS.length;

/** How strong a day is drawn: 0 for nothing, 1 to 10 against the average of the active days. */
export function activityLevel(seconds: number, average: number): number {
  if (!(seconds > 0) || !(average > 0)) return 0;
  return STEPS.filter((step) => seconds > step * average).length;
}

export interface ActivityFacts {
  /** Per day, from the first active day to today. */
  average: number;
  /** Per day, counting only the days with something. */
  activeAverage: number;
  /** Share of the days with something, from the first one to today. */
  activeShare: number;
  longest: number;
  /** Up to today, or yesterday when today has nothing yet. */
  current: number;
}

/** The figures under the calendar. `days` are in order, one entry per day, ending today. */
export function activityFacts(days: { day: string; seconds: number }[]): ActivityFacts {
  const start = days.findIndex((day) => day.seconds > 0);
  if (start === -1) return { average: 0, activeAverage: 0, activeShare: 0, longest: 0, current: 0 };
  const counted = days.slice(start);
  const active = counted.filter((day) => day.seconds > 0).length;
  const total = counted.reduce((sum, day) => sum + day.seconds, 0);
  let longest = 0;
  let run = 0;
  let beforeToday = 0;
  for (const day of counted) {
    beforeToday = run;
    run = day.seconds > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    average: total / counted.length,
    activeAverage: total / active,
    activeShare: active / counted.length,
    longest,
    current: run > 0 ? run : beforeToday,
  };
}
