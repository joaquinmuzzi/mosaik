/**
 * Builds the Deuchan rows of `contents`, `sessions` and `day_totals` from the events in `raw_events`.
 * Everything here can be thrown away and rebuilt.
 *
 * Deuchan sends from several devices (computers, Chrome profiles), each with its own token, and each
 * sends only what was watched or read there.
 *
 * - An item is a YouTube video (`yt:<videoId>`) or anything else the source names (`web:<hash>`: a
 *   video on another site, a page read by hand).
 * - Intervals of the same item on the same device less than 10 minutes apart make one session.
 * - An item the person removed from a day loses its intervals of that day up to the removal, on every
 *   device (Deuchan's day: the local calendar day in which the interval ended). What is counted after
 *   the removal stays: a page on another site goes on counting, as it does in Deuchan.
 * - Per device and day, the newest `day_total` snapshot is what that device's dashboard shows,
 *   corrections included. The day is the sum of its devices. It is never derived from the intervals.
 */
import {
  type ContentKind,
  type DayTotalEvent,
  type IngestEvent,
  type VideoRemovedEvent,
  type WatchIntervalEvent,
  dayKey,
  deuchanContentId,
} from "@mosaik/shared";
import type { Database } from "../db/database.ts";

export const DEUCHAN_SOURCE = "deuchan";

/** Intervals closer than this belong to the same session. */
export const SESSION_GAP_MS = 10 * 60_000;

export const videoContentId = (videoId: string) => `yt:${videoId}`;

export const youtubeUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export interface DeuchanDeriveOptions {
  timeZone: string;
}

export interface DeuchanDeriveResult {
  videos: number;
  sessions: number;
  seconds: number;
  days: number;
}

/** An event as stored, with the device that sent it. */
export type StoredEvent = IngestEvent & { device: string };

export function loadDeuchanEvents(db: Database): StoredEvent[] {
  return (
    db
      .prepare("SELECT payload, device FROM raw_events WHERE source = ? ORDER BY received_at, id")
      .all(DEUCHAN_SOURCE) as { payload: string; device: string }[]
  ).map((row) => ({ ...(JSON.parse(row.payload) as IngestEvent), device: row.device }));
}

/**
 * The intervals that still count: an item removed from a day loses what was counted of it that day up
 * to its newest removal; an interval that goes past the removal keeps the part after it.
 */
export function countedIntervals<T extends IngestEvent>(
  events: T[],
  timeZone: string,
): (T & WatchIntervalEvent)[] {
  const removedAt = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== "video_removed") continue;
    const removal = event as T & VideoRemovedEvent;
    const key = `${removal.day}|${deuchanContentId(removal)}`;
    removedAt.set(key, Math.max(removedAt.get(key) ?? 0, removal.at));
  }
  const counted: (T & WatchIntervalEvent)[] = [];
  for (const event of events) {
    if (event.kind !== "watch_interval") continue;
    const interval = event as T & WatchIntervalEvent;
    const at = removedAt.get(`${dayKey(interval.to, timeZone, 0)}|${deuchanContentId(interval)}`);
    if (at === undefined || interval.from >= at) {
      counted.push(interval);
    } else if (interval.to > at) {
      // Its seconds are spread over it: the share after the removal stays
      const share = (interval.to - at) / (interval.to - interval.from);
      counted.push({ ...interval, from: at, seconds: interval.seconds * share });
    }
  }
  return counted;
}

/**
 * What each item's counted time mostly was: the same page can be counted by hand as reading once and
 * as sound another time (a podcast).
 */
function countedKinds(intervals: WatchIntervalEvent[]): Map<string, ContentKind> {
  const balance = new Map<string, number>();
  for (const interval of intervals) {
    const id = deuchanContentId(interval);
    const sign = interval.contentKind === "reading" ? 1 : -1;
    balance.set(id, (balance.get(id) ?? 0) + sign * interval.seconds);
  }
  return new Map([...balance].map(([id, reading]) => [id, reading > 0 ? "reading" : "video"]));
}

interface ItemInfo {
  title: string | null;
  titleAt: number;
  url: string | null;
  videoId: string | null;
  kind: ContentKind;
}

/** Rebuilds Deuchan's rows of the common model. Call it inside a transaction. */
export function rebuildDeuchan(db: Database, { timeZone }: DeuchanDeriveOptions): DeuchanDeriveResult {
  db.prepare("DELETE FROM sessions WHERE source = ?").run(DEUCHAN_SOURCE);
  db.prepare("DELETE FROM contents WHERE source = ?").run(DEUCHAN_SOURCE);
  db.prepare("DELETE FROM day_totals WHERE source = ?").run(DEUCHAN_SOURCE);

  const events = loadDeuchanEvents(db);
  const intervals = countedIntervals(events, timeZone).sort(
    (a, b) => a.from - b.from || a.id.localeCompare(b.id),
  );

  // Items, with the newest non-empty title seen for each (videos get renamed)
  const items = new Map<string, ItemInfo>();
  const see = (
    item: {
      videoId?: string | undefined;
      itemId?: string | undefined;
      url?: string | undefined;
      contentKind?: ContentKind | undefined;
    },
    title: string | undefined,
    at: number,
  ) => {
    const id = deuchanContentId(item);
    const known = items.get(id) ?? {
      title: null,
      titleAt: at,
      url: null,
      videoId: item.videoId ?? null,
      kind: item.contentKind ?? "video",
    };
    if (title && (!known.title || at >= known.titleAt)) {
      known.title = itemTitle(item, title);
      known.titleAt = at;
    }
    if (item.url) known.url = item.url;
    if (item.contentKind) known.kind = item.contentKind;
    items.set(id, known);
  };
  for (const event of events) {
    if (event.kind === "watch_interval") see(event, event.title, event.to);
    if (event.kind === "day_total") for (const video of event.videos ?? []) see(video, video.title, event.at);
  }
  // What was removed does not decide the kind; an item with nothing counted keeps what its source said
  for (const [id, kind] of countedKinds(intervals)) items.get(id)!.kind = kind;
  const insertContent = db.prepare(
    `INSERT INTO contents (id, source, kind, title, external_id, parent_id, total_units, unit, meta)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  );
  for (const [id, item] of items) {
    const url = item.url ?? (item.videoId ? youtubeUrl(item.videoId) : null);
    insertContent.run(
      id,
      DEUCHAN_SOURCE,
      item.kind === "reading" ? "book" : "video",
      item.title,
      item.videoId,
      JSON.stringify(url ? { url } : {}),
    );
  }

  // Sessions: the intervals of each item on each device, cut where they are 10 minutes or more apart
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds, units, unit, lines, device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  );
  const byItem = new Map<string, typeof intervals>();
  for (const interval of intervals) {
    const key = `${interval.device}\u0000${deuchanContentId(interval)}`;
    const list = byItem.get(key) ?? [];
    list.push(interval);
    byItem.set(key, list);
  }
  let sessions = 0;
  let seconds = 0;
  for (const list of byItem.values()) {
    const first = list[0]!;
    const contentId = deuchanContentId(first);
    const medium = items.get(contentId)?.kind === "reading" ? "reading" : "video";
    let current: { id: string; language: string; start: number; end: number; seconds: number } | null = null;
    const flush = () => {
      if (!current) return;
      insertSession.run(
        `deuchan:${current.id}`,
        DEUCHAN_SOURCE,
        medium,
        current.language,
        contentId,
        current.start,
        current.end,
        current.seconds,
        first.device,
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

  // Day totals: per device and day, the newest snapshot
  const newest = newestSnapshots(events);
  const insertDay = db.prepare(
    `INSERT INTO day_totals (source, device, day, seconds, reading_seconds, at, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const days = new Set<string>();
  for (const event of newest) {
    insertDay.run(
      DEUCHAN_SOURCE,
      event.device,
      event.day,
      event.seconds,
      event.readingSeconds ?? 0,
      event.at,
      event.id,
    );
    days.add(event.day);
  }

  return { videos: items.size, sessions, seconds, days: days.size };
}

/** For each device and day, the snapshot with the newest `at`. */
export function newestSnapshots(events: StoredEvent[]): (DayTotalEvent & { device: string })[] {
  const newest = new Map<string, DayTotalEvent & { device: string }>();
  for (const event of events) {
    if (event.kind !== "day_total") continue;
    const key = `${event.device}\u0000${event.day}`;
    const known = newest.get(key);
    if (!known || event.at > known.at || (event.at === known.at && event.id > known.id))
      newest.set(key, event);
  }
  return [...newest.values()];
}

/** An item of a day as the newest snapshots of its devices list it. */
export interface DeuchanDayItem {
  contentId: string;
  videoId: string | null;
  title: string | null;
  url: string | null;
  contentKind: ContentKind;
  seconds: number;
  /** The devices it was watched or read on, most seconds first. */
  devices: string[];
  /** Its seconds on each device. */
  secondsByDevice: Record<string, number>;
}

/**
 * The items of the newest snapshot of each device, per day: an item on two devices is listed once
 * with the sum of its seconds. Most seconds first.
 */
export function snapshotItemsByDay(
  db: Database,
  days?: { from: string; to: string },
): Map<string, DeuchanDayItem[]> {
  const rows = db
    .prepare(
      `SELECT d.day, d.device, e.payload FROM day_totals d JOIN raw_events e ON e.id = d.event_id
       WHERE d.source = 'deuchan' ${days ? "AND d.day BETWEEN ? AND ?" : ""}`,
    )
    .all(...(days ? [days.from, days.to] : [])) as { day: string; device: string; payload: string }[];
  const byDay = new Map<string, Map<string, DeuchanDayItem & { perDevice: Map<string, number> }>>();
  for (const row of rows) {
    const event = JSON.parse(row.payload) as DayTotalEvent;
    const list = byDay.get(row.day) ?? new Map();
    for (const video of event.videos ?? []) {
      const contentId = deuchanContentId(video);
      const item = list.get(contentId) ?? {
        contentId,
        videoId: video.videoId ?? null,
        title: null,
        url: null,
        contentKind: video.contentKind ?? "video",
        seconds: 0,
        devices: [],
        secondsByDevice: {},
        perDevice: new Map<string, number>(),
      };
      item.seconds += video.seconds;
      item.title = item.title || itemTitle(video, video.title) || null;
      item.url = item.url ?? video.url ?? (video.videoId ? youtubeUrl(video.videoId) : null);
      item.perDevice.set(row.device, (item.perDevice.get(row.device) ?? 0) + video.seconds);
      list.set(contentId, item);
    }
    byDay.set(row.day, list);
  }
  const result = new Map<string, DeuchanDayItem[]>();
  for (const [day, list] of byDay) {
    result.set(
      day,
      [...list.values()]
        .map(({ perDevice, ...item }) => ({
          ...item,
          devices: [...perDevice.entries()].sort((a, b) => b[1] - a[1]).map(([device]) => device),
          secondsByDevice: Object.fromEntries(perDevice),
        }))
        .sort((a, b) => b.seconds - a.seconds),
    );
  }
  return result;
}

/**
 * Titles of the items Deuchan saw on each day (Deuchan's day), for matching a card's source title:
 * day → normalized title → content id.
 */
export function deuchanTitlesByDay(db: Database, timeZone: string): Map<string, Map<string, string>> {
  const events = loadDeuchanEvents(db);
  const byDay = new Map<string, Map<string, string>>();
  const add = (day: string, title: string | undefined, contentId: string) => {
    if (!title) return;
    const titles = byDay.get(day) ?? new Map<string, string>();
    titles.set(normalizeTitle(title), contentId);
    byDay.set(day, titles);
  };
  for (const event of countedIntervals(events, timeZone))
    add(dayKey(event.to, timeZone, 0), event.title, deuchanContentId(event));
  for (const event of events) {
    if (event.kind === "day_total")
      for (const video of event.videos ?? []) add(event.day, video.title, deuchanContentId(video));
  }
  return byDay;
}

/**
 * The title of an item as it is shown. A page on another site is named after its tab, and many sites
 * (Twitch, Facebook) put the count of unread notifications in front of it, "(2) Twitch": that count
 * goes. A YouTube video keeps its title as it is, which can start like that.
 */
export function itemTitle(item: { videoId?: string | undefined }, title: string | undefined): string {
  if (!title) return "";
  return item.videoId ? title : title.replace(/^\(\d+\+?\)\s+/, "");
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
