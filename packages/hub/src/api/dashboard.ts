/**
 * What the dashboard reads: a summary per day, the detail of one day, and Anki by card origin.
 *
 * Days: GSM reading time and Anki use Mosaik's day (the user's time zone, starting at the cutoff
 * hour). Deuchan's total is the one Deuchan shows, for Deuchan's own day (midnight to midnight): it
 * is not cut again, so it always matches what Deuchan's dashboard says.
 */
import type {
  AnkiStatsResponse,
  DayDetailResponse,
  DaySummary,
  DayVideo,
  OriginRetention,
  OriginStats,
  OverviewResponse,
  WeekPoint,
} from "@mosaik/shared";
import { dayKey } from "@mosaik/shared";
import { deviceLabels } from "../auth.ts";
import type { Database } from "../db/database.ts";
import { snapshotItemsByDay } from "../derive/deuchan.ts";
import { COUNTED_REVIEW_TYPES } from "../metrics/reviews.ts";

export interface DashboardOptions {
  timeZone: string;
  cutoffHour: number;
  targetLanguage: string;
  /** Whether YouTube thumbnails may be fetched (YOUTUBE_THUMBNAILS). */
  youtubeThumbnails?: boolean;
}

/** An interval of 21 days or more makes a card mature, as in Anki's statistics. */
const MATURE_DAYS = 21;

const COUNTED = `(${COUNTED_REVIEW_TYPES.join(", ")})`;

/** `2026-11-14` plus `n` days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday of the week of `day`. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;

export interface Totals {
  gsm: Map<string, number>;
  deuchan: Map<string, number>;
  reviews: Map<string, { count: number; seconds: number }>;
  mined: Map<string, number>;
}

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

/** Every per-day total, computed once from the common tables. */
export function dailyTotals(
  db: Database,
  { timeZone, cutoffHour, targetLanguage }: DashboardOptions,
): Totals {
  const day = (ts: number) => dayKey(ts, timeZone, cutoffHour);
  const gsm = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT l.ts, l.seconds FROM lines l JOIN sessions s ON s.id = l.session_id
       WHERE l.source = 'gsm' AND s.language = ? AND l.seconds > 0`,
    )
    .all(targetLanguage) as { ts: number; seconds: number }[]) {
    add(gsm, day(row.ts), row.seconds);
  }
  const deuchan = new Map<string, number>();
  for (const row of db.prepare("SELECT day, seconds FROM day_totals WHERE source = 'deuchan'").all() as {
    day: string;
    seconds: number;
  }[]) {
    // Each device sends only its own time: the day is their sum
    add(deuchan, row.day, row.seconds);
  }
  const reviews = new Map<string, { count: number; seconds: number }>();
  for (const row of db.prepare(`SELECT ts, time_ms FROM reviews WHERE type IN ${COUNTED}`).all() as {
    ts: number;
    time_ms: number;
  }[]) {
    const key = day(row.ts);
    const entry = reviews.get(key) ?? { count: 0, seconds: 0 };
    entry.count += 1;
    entry.seconds += row.time_ms / 1000;
    reviews.set(key, entry);
  }
  const mined = new Map<string, number>();
  for (const row of db.prepare("SELECT created_ts FROM cards WHERE origin != 'refold-1k'").all() as {
    created_ts: number;
  }[]) {
    add(mined, day(row.created_ts), 1);
  }
  return { gsm, deuchan, reviews, mined };
}

export function summaryOf(totals: Totals, day: string): DaySummary {
  const reviews = totals.reviews.get(day);
  return {
    day,
    gsmSeconds: totals.gsm.get(day) ?? 0,
    deuchanSeconds: totals.deuchan.has(day) ? totals.deuchan.get(day)! : null,
    reviews: reviews?.count ?? 0,
    reviewSeconds: reviews?.seconds ?? 0,
    cardsMined: totals.mined.get(day) ?? 0,
  };
}

const immersion = (summary: DaySummary) => summary.gsmSeconds + (summary.deuchanSeconds ?? 0);

export function overview(
  db: Database,
  options: DashboardOptions,
  days: number,
  now = Date.now(),
): OverviewResponse {
  const today = dayKey(now, options.timeZone, options.cutoffHour);
  const totals = dailyTotals(db, options);
  const list = Array.from({ length: days }, (_, index) =>
    summaryOf(totals, addDays(today, index - days + 1)),
  );

  // A day that has not had anything yet does not break the streak
  let cursor = immersion(summaryOf(totals, today)) > 0 ? today : addDays(today, -1);
  let streak = 0;
  while (immersion(summaryOf(totals, cursor)) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { today, cutoffHour: options.cutoffHour, timeZone: options.timeZone, days: list, streak };
}

export function dayDetail(db: Database, options: DashboardOptions, day: string): DayDetailResponse {
  const { timeZone, cutoffHour, targetLanguage } = options;
  const inDay = (ts: number) => dayKey(ts, timeZone, cutoffHour) === day;
  // A day of Mosaik lies within these bounds, whatever the zone's offset: filter there, then exactly
  const from = Date.parse(`${addDays(day, -1)}T00:00:00Z`);
  const to = Date.parse(`${addDays(day, 2)}T00:00:00Z`);

  // GSM: the time each line got, added up by session, for the lines read that day
  const sessions = new Map<string, DayDetailResponse["gsm"]["sessions"][number]>();
  let otherLanguageSeconds = 0;
  for (const row of db
    .prepare(
      `SELECT l.ts, l.seconds, l.chars, s.id, s.language, c.title
       FROM lines l JOIN sessions s ON s.id = l.session_id LEFT JOIN contents c ON c.id = s.content_id
       WHERE l.source = 'gsm' AND l.ts BETWEEN ? AND ? ORDER BY l.ts`,
    )
    .all(from, to) as {
    ts: number;
    seconds: number;
    chars: number;
    id: string;
    language: string;
    title: string | null;
  }[]) {
    if (!inDay(row.ts)) continue;
    if (row.language !== targetLanguage) {
      otherLanguageSeconds += row.seconds;
      continue;
    }
    const session = sessions.get(row.id) ?? {
      id: row.id,
      title: row.title,
      start: row.ts,
      end: row.ts,
      seconds: 0,
      characters: 0,
      lines: 0,
    };
    session.end = row.ts;
    session.seconds += row.seconds;
    session.characters = (session.characters ?? 0) + row.chars;
    session.lines = (session.lines ?? 0) + 1;
    sessions.set(row.id, session);
  }
  const gsmSessions = [...sessions.values()];

  // Deuchan: the total of each device for the day, and the items of their newest snapshots
  const deuchanDevices = db
    .prepare(
      `SELECT device, seconds, reading_seconds, at FROM day_totals
       WHERE source = 'deuchan' AND day = ? ORDER BY seconds DESC, device`,
    )
    .all(day) as { device: string; seconds: number; reading_seconds: number; at: number }[];
  const labelOf = deviceLabels(db);
  const videos: DayVideo[] = (snapshotItemsByDay(db, { from: day, to: day }).get(day) ?? []).map((item) => ({
    id: item.contentId,
    videoId: item.videoId,
    title: item.title,
    url: item.url,
    contentKind: item.contentKind,
    seconds: item.seconds,
    // Devices of one computer can share a label: each is shown once
    devices: [...new Set(item.devices.map(labelOf))],
  }));

  // Anki
  const byType = { learning: 0, review: 0, relearning: 0, filtered: 0 };
  let reviews = 0;
  let reviewSeconds = 0;
  for (const row of db
    .prepare(`SELECT ts, type, time_ms FROM reviews WHERE type IN ${COUNTED} AND ts BETWEEN ? AND ?`)
    .all(from, to) as { ts: number; type: number; time_ms: number }[]) {
    if (!inDay(row.ts)) continue;
    reviews += 1;
    reviewSeconds += row.time_ms / 1000;
    if (row.type === 0) byType.learning += 1;
    else if (row.type === 1) byType.review += 1;
    else if (row.type === 2) byType.relearning += 1;
    else byType.filtered += 1;
  }
  const firstSeen = db
    .prepare(
      `SELECT card_id, MIN(ts) AS first FROM reviews WHERE type IN ${COUNTED} GROUP BY card_id HAVING first BETWEEN ? AND ?`,
    )
    .all(from, to) as { first: number }[];
  const mined = (
    db
      .prepare(
        `SELECT c.note_id, c.word, c.origin, c.source_title, c.created_ts, t.title AS content_title
         FROM cards c LEFT JOIN contents t ON t.id = c.content_id
         WHERE c.origin != 'refold-1k' AND c.created_ts BETWEEN ? AND ? ORDER BY c.created_ts`,
      )
      .all(from, to) as {
      note_id: number;
      word: string | null;
      origin: string;
      source_title: string | null;
      created_ts: number;
      content_title: string | null;
    }[]
  )
    .filter((row) => inDay(row.created_ts))
    .map((row) => ({
      noteId: row.note_id,
      word: row.word,
      origin: row.origin,
      contentTitle: row.content_title,
      sourceTitle: row.source_title,
      created: row.created_ts,
    }));

  return {
    day,
    cutoffHour,
    timeZone,
    gsm: {
      seconds: gsmSessions.reduce((sum, session) => sum + session.seconds, 0),
      sessions: gsmSessions,
      otherLanguageSeconds,
    },
    deuchan: {
      seconds: deuchanDevices.length > 0 ? deuchanDevices.reduce((sum, row) => sum + row.seconds, 0) : null,
      readingSeconds: deuchanDevices.reduce((sum, row) => sum + row.reading_seconds, 0),
      devices: deuchanDevices.map((row) => ({
        device: row.device,
        label: labelOf(row.device),
        seconds: row.seconds,
        at: row.at,
      })),
      snapshotAt: deuchanDevices.length > 0 ? Math.max(...deuchanDevices.map((row) => row.at)) : null,
      videos,
    },
    anki: {
      reviews,
      byType,
      seconds: reviewSeconds,
      newCards: firstSeen.filter((row) => inDay(row.first)).length,
      mined,
    },
  };
}

const emptyRetention = (): OriginRetention => ({ reviews: 0, passed: 0 });

export function ankiStats(db: Database, options: DashboardOptions, now = Date.now()): AnkiStatsResponse {
  const { timeZone, cutoffHour } = options;
  const origins = new Map<string, OriginStats>();
  const statsFor = (origin: string) => {
    let stats = origins.get(origin);
    if (!stats) {
      stats = { origin, cards: 0, mature: 0, young: emptyRetention(), matureRetention: emptyRetention() };
      origins.set(origin, stats);
    }
    return stats;
  };
  for (const row of db
    .prepare(
      `SELECT c.origin, COUNT(*) AS cards,
         SUM(CASE WHEN k.interval >= ${MATURE_DAYS} THEN 1 ELSE 0 END) AS mature
       FROM cards c LEFT JOIN raw_anki_cards k ON k.note_id = c.note_id AND k.removed_at IS NULL
       GROUP BY c.origin`,
    )
    .all() as { origin: string; cards: number; mature: number | null }[]) {
    const stats = statsFor(row.origin);
    stats.cards = row.cards;
    stats.mature = row.mature ?? 0;
  }
  // Retention: answers on review cards; "Again" (ease 1) is a lapse
  for (const row of db
    .prepare(
      `SELECT c.origin, r.last_ivl >= ${MATURE_DAYS} AS mature, COUNT(*) AS reviews,
         SUM(CASE WHEN r.ease > 1 THEN 1 ELSE 0 END) AS passed
       FROM reviews r JOIN cards c ON c.note_id = r.note_id
       WHERE r.type = 1 GROUP BY c.origin, mature`,
    )
    .all() as { origin: string; mature: number; reviews: number; passed: number }[]) {
    const stats = statsFor(row.origin);
    const target = row.mature ? stats.matureRetention : stats.young;
    target.reviews += row.reviews;
    target.passed += row.passed;
  }

  // Weeks: immersion and the cards that became mature (first time), from the first data to today
  const day = (ts: number) => dayKey(ts, timeZone, cutoffHour);
  const totals = dailyTotals(db, options);
  const matured = db
    .prepare(
      `SELECT c.origin, MIN(r.ts) AS first FROM reviews r JOIN cards c ON c.note_id = r.note_id
       WHERE r.type IN ${COUNTED} AND r.ivl >= ${MATURE_DAYS} GROUP BY r.card_id`,
    )
    .all() as { origin: string; first: number }[];
  const firstDays = [
    ...totals.gsm.keys(),
    ...totals.deuchan.keys(),
    ...totals.reviews.keys(),
    ...matured.map((row) => day(row.first)),
  ].sort();
  const weeks: WeekPoint[] = [];
  if (firstDays.length > 0) {
    const index = new Map<string, WeekPoint>();
    const last = mondayOf(dayKey(now, timeZone, cutoffHour));
    for (let week = mondayOf(firstDays[0]!); week <= last; week = addDays(week, 7)) {
      const point = { week, gsmSeconds: 0, deuchanSeconds: 0, maturedMined: 0, maturedRefold: 0 };
      weeks.push(point);
      index.set(week, point);
    }
    for (const [key, seconds] of totals.gsm) {
      const point = index.get(mondayOf(key));
      if (point) point.gsmSeconds += seconds;
    }
    for (const [key, seconds] of totals.deuchan) {
      const point = index.get(mondayOf(key));
      if (point) point.deuchanSeconds += seconds;
    }
    for (const row of matured) {
      const point = index.get(mondayOf(day(row.first)));
      if (!point) continue;
      if (row.origin === "refold-1k") point.maturedRefold += 1;
      else point.maturedMined += 1;
    }
    let mined = 0;
    let refold = 0;
    for (const point of weeks) {
      mined += point.maturedMined;
      refold += point.maturedRefold;
      point.maturedMined = mined;
      point.maturedRefold = refold;
    }
  }

  const order = ["gsm", "youtube", "refold-1k", "unknown"];
  return {
    origins: [...origins.values()].sort((a, b) => order.indexOf(a.origin) - order.indexOf(b.origin)),
    weeks,
  };
}
