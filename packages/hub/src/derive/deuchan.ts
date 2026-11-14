/**
 * Builds the Deuchan rows of `contents`, `sessions` and `day_totals` from the events in `raw_events`.
 * Everything here can be thrown away and rebuilt.
 *
 * - Intervals of the same video less than 10 minutes apart make one session.
 * - A video the person removed from a day loses its intervals of that day (Deuchan's day: the local
 *   calendar day in which the interval ended).
 * - The total of a day is the newest `day_total` snapshot: it is what Deuchan's dashboard shows,
 *   corrections and other computers included. It is never derived from the intervals or from the
 *   `videos` of the snapshot, which only hold this computer's videos.
 */
import {
  type DayTotalEvent,
  type IngestEvent,
  type VideoRemovedEvent,
  type WatchIntervalEvent,
  dayKey,
} from "@mosaik/shared";
import type { Database } from "../db/database.ts";

export const DEUCHAN_SOURCE = "deuchan";

/** Intervals closer than this belong to the same session. */
export const SESSION_GAP_MS = 10 * 60_000;

export const videoContentId = (videoId: string) => `yt:${videoId}`;

export interface DeuchanDeriveOptions {
  timeZone: string;
}

export interface DeuchanDeriveResult {
  videos: number;
  sessions: number;
  seconds: number;
  days: number;
}

function loadEvents(db: Database): IngestEvent[] {
  return (
    db
      .prepare("SELECT payload FROM raw_events WHERE source = ? ORDER BY received_at, id")
      .all(DEUCHAN_SOURCE) as {
      payload: string;
    }[]
  ).map((row) => JSON.parse(row.payload) as IngestEvent);
}

/** The intervals that still count: those of videos not removed from their day. */
export function countedIntervals(events: IngestEvent[], timeZone: string): WatchIntervalEvent[] {
  const removed = new Set(
    events
      .filter((event): event is VideoRemovedEvent => event.kind === "video_removed")
      .map((event) => `${event.day}|${event.videoId}`),
  );
  return events
    .filter((event): event is WatchIntervalEvent => event.kind === "watch_interval")
    .filter((event) => !removed.has(`${dayKey(event.to, timeZone, 0)}|${event.videoId}`));
}

/** Rebuilds Deuchan's rows of the common model. Call it inside a transaction. */
export function rebuildDeuchan(db: Database, { timeZone }: DeuchanDeriveOptions): DeuchanDeriveResult {
  db.prepare("DELETE FROM sessions WHERE source = ?").run(DEUCHAN_SOURCE);
  db.prepare("DELETE FROM contents WHERE source = ?").run(DEUCHAN_SOURCE);
  db.prepare("DELETE FROM day_totals WHERE source = ?").run(DEUCHAN_SOURCE);

  const events = loadEvents(db);
  const intervals = countedIntervals(events, timeZone).sort(
    (a, b) => a.from - b.from || a.id.localeCompare(b.id),
  );

  // Videos, with the newest title seen for each
  const titles = new Map<string, { title: string | null; at: number }>();
  // The newest non-empty title wins: videos get renamed
  const seeTitle = (videoId: string, title: string | undefined, at: number) => {
    const known = titles.get(videoId);
    if (!title) {
      if (!known) titles.set(videoId, { title: null, at });
    } else if (!known || !known.title || at >= known.at) {
      titles.set(videoId, { title, at });
    }
  };
  for (const event of events) {
    if (event.kind === "watch_interval") seeTitle(event.videoId, event.title, event.to);
    if (event.kind === "day_total")
      for (const video of event.videos ?? []) seeTitle(video.videoId, video.title, event.at);
  }
  const insertContent = db.prepare(
    `INSERT INTO contents (id, source, kind, title, external_id, parent_id, total_units, unit, meta)
     VALUES (?, ?, 'video', ?, ?, NULL, NULL, NULL, ?)`,
  );
  for (const [videoId, { title }] of titles) {
    insertContent.run(
      videoContentId(videoId),
      DEUCHAN_SOURCE,
      title,
      videoId,
      JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
    );
  }

  // Sessions: the intervals of each video, cut where they are 10 minutes or more apart
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds, units, unit, lines)
     VALUES (?, ?, 'video', ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  );
  const byVideo = new Map<string, WatchIntervalEvent[]>();
  for (const interval of intervals) {
    const list = byVideo.get(interval.videoId) ?? [];
    list.push(interval);
    byVideo.set(interval.videoId, list);
  }
  let sessions = 0;
  let seconds = 0;
  for (const [videoId, list] of byVideo) {
    let current: { id: string; language: string; start: number; end: number; seconds: number } | null = null;
    const flush = () => {
      if (!current) return;
      insertSession.run(
        `deuchan:${current.id}`,
        DEUCHAN_SOURCE,
        current.language,
        videoContentId(videoId),
        current.start,
        current.end,
        current.seconds,
      );
      sessions += 1;
      seconds += current.seconds;
    };
    for (const interval of list) {
      if (current && interval.from - current.end < SESSION_GAP_MS) {
        current.end = Math.max(current.end, interval.to);
        current.seconds += interval.seconds;
      } else {
        flush();
        current = {
          id: interval.id,
          language: interval.language,
          start: interval.from,
          end: interval.to,
          seconds: interval.seconds,
        };
      }
    }
    flush();
  }

  // Day totals: per day, the newest snapshot
  const newest = new Map<string, DayTotalEvent>();
  for (const event of events) {
    if (event.kind !== "day_total") continue;
    const known = newest.get(event.day);
    if (!known || event.at > known.at || (event.at === known.at && event.id > known.id))
      newest.set(event.day, event);
  }
  const insertDay = db.prepare("INSERT INTO day_totals (source, day, seconds, at) VALUES (?, ?, ?, ?)");
  for (const [day, event] of newest) insertDay.run(DEUCHAN_SOURCE, day, event.seconds, event.at);

  return { videos: titles.size, sessions, seconds, days: newest.size };
}

/**
 * Titles of the videos Deuchan saw on each day (Deuchan's day), for matching a card's source title:
 * day → normalized title → content id.
 */
export function deuchanTitlesByDay(db: Database, timeZone: string): Map<string, Map<string, string>> {
  const events = loadEvents(db);
  const byDay = new Map<string, Map<string, string>>();
  const add = (day: string, title: string | undefined, videoId: string) => {
    if (!title) return;
    const titles = byDay.get(day) ?? new Map<string, string>();
    titles.set(normalizeTitle(title), videoContentId(videoId));
    byDay.set(day, titles);
  };
  for (const event of countedIntervals(events, timeZone))
    add(dayKey(event.to, timeZone, 0), event.title, event.videoId);
  for (const event of events) {
    if (event.kind === "day_total")
      for (const video of event.videos ?? []) add(event.day, video.title, video.videoId);
  }
  return byDay;
}

/** Titles compared without case, spacing or a trailing " - YouTube". */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .replace(/\s+-\s+YouTube$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The YouTube video id in a URL (watch, youtu.be, shorts, embed), or null. */
export function youtubeVideoIdOf(text: string): string | null {
  const match =
    /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(
      text,
    );
  return match ? match[1]! : null;
}
