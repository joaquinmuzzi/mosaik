/**
 * Statistics over the whole history: every day since the first one with anything, and the
 * highlights (the content with most time, the biggest day, the longest streaks…).
 *
 * The numbers come from the same totals as the rest of the dashboard: GSM reading time and Anki on
 * Mosaik's day, Deuchan's total on Deuchan's own day.
 */
import type { DaySummary, HighlightContent, Highlights, StatsResponse, StreakRecord } from "@mosaik/shared";
import { dayKey } from "@mosaik/shared";
import type { Database } from "../db/database.ts";
import { listContents, videoTotals } from "./contents.ts";
import { type DashboardOptions, addDays, dailyTotals, summaryOf } from "./dashboard.ts";

const immersion = (day: DaySummary) => day.gsmSeconds + (day.deuchanSeconds ?? 0);

/** The longest run of consecutive days among `days`; on a tie, the most recent one. */
export function longestRun(days: Iterable<string>): StreakRecord | null {
  const sorted = [...new Set(days)].sort();
  let best: StreakRecord | null = null;
  let start = 0;
  for (let index = 0; index < sorted.length; index++) {
    if (index > 0 && addDays(sorted[index - 1]!, 1) !== sorted[index]) start = index;
    const length = index - start + 1;
    if (!best || length >= best.days) best = { days: length, from: sorted[start]!, to: sorted[index]! };
  }
  return best;
}

/** Every day from the first one with anything to today, empty days included. */
export function allDays(db: Database, options: DashboardOptions, now = Date.now()): DaySummary[] {
  const today = dayKey(now, options.timeZone, options.cutoffHour);
  const totals = dailyTotals(db, options);
  const keys = [totals.gsm, totals.deuchan, totals.reviews, totals.mined].flatMap((map) => [...map.keys()]);
  const first = keys.filter((key) => key <= today).sort()[0] ?? today;
  const days: DaySummary[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) days.push(summaryOf(totals, day));
  return days;
}

/** The days each content had time: GSM lines in the target language, or Deuchan's daily credit. */
function contentDays(db: Database, options: DashboardOptions): Map<string, Set<string>> {
  const day = (ts: number) => dayKey(ts, options.timeZone, options.cutoffHour);
  const result = new Map<string, Set<string>>();
  const mark = (id: string, key: string) => {
    const set = result.get(id) ?? new Set<string>();
    set.add(key);
    result.set(id, set);
  };
  for (const row of db
    .prepare(
      `SELECT l.content_id, l.ts FROM lines l JOIN sessions s ON s.id = l.session_id
       WHERE l.source = 'gsm' AND s.language = ? AND l.seconds > 0 AND l.content_id IS NOT NULL`,
    )
    .all(options.targetLanguage) as { content_id: string; ts: number }[]) {
    mark(row.content_id, day(row.ts));
  }
  const videos = videoTotals(db);
  for (const row of db
    .prepare("SELECT id, external_id FROM contents WHERE source = 'deuchan' AND external_id IS NOT NULL")
    .all() as { id: string; external_id: string }[]) {
    for (const [key, seconds] of videos.get(row.external_id)?.days ?? []) {
      if (seconds > 0) mark(row.id, key);
    }
  }
  return result;
}

export function stats(db: Database, options: DashboardOptions, now = Date.now()): StatsResponse {
  const days = allDays(db, options, now);
  const contents = listContents(db, options).contents;

  const top = (value: (content: (typeof contents)[number]) => number | null): HighlightContent | null => {
    let best: HighlightContent | null = null;
    for (const content of contents) {
      const amount = value(content) ?? 0;
      if (amount > 0 && (!best || amount > best.value)) {
        best = { id: content.id, title: content.title, kind: content.kind, value: amount };
      }
    }
    return best;
  };

  const active = days.filter((day) => immersion(day) > 0);
  let biggestDay: Highlights["biggestDay"] = null;
  for (const day of active) {
    if (!biggestDay || immersion(day) > biggestDay.seconds) {
      biggestDay = { day: day.day, seconds: immersion(day) };
    }
  }

  const byId = new Map(contents.map((content) => [content.id, content]));
  let longestTitleStreak: Highlights["longestTitleStreak"] = null;
  for (const [id, set] of contentDays(db, options)) {
    const content = byId.get(id);
    const run = content ? longestRun(set) : null;
    if (content && run && (!longestTitleStreak || run.days > longestTitleStreak.days)) {
      longestTitleStreak = { ...run, id, title: content.title, kind: content.kind };
    }
  }

  return {
    today: dayKey(now, options.timeZone, options.cutoffHour),
    cutoffHour: options.cutoffHour,
    timeZone: options.timeZone,
    days,
    highlights: {
      mostTime: top((content) => content.seconds),
      mostSessions: top((content) => content.sessions),
      mostCharacters: top((content) => content.characters),
      mostMined: top((content) => content.cardsMined),
      biggestDay,
      longestStreak: longestRun(active.map((day) => day.day)),
      longestTitleStreak,
    },
  };
}
