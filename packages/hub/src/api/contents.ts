/**
 * Contents (games, videos) with their totals, the detail of one, and the sentence search.
 *
 * Time per content:
 * - GSM games: the reading time of their sessions in the target language.
 * - Deuchan videos: what Deuchan credited each video, from the newest snapshot of each day (this
 *   computer's videos only). Deuchan's history has no intervals, so its sessions only exist from the
 *   day "Send to Mosaik" was turned on; the snapshots cover the whole history.
 */
import type {
  ContentDetailResponse,
  CoverSource,
  ContentLine,
  ContentSummary,
  ContentsResponse,
  SearchHit,
  SearchResponse,
} from "@mosaik/shared";
import { dayKey } from "@mosaik/shared";
import type { Database } from "../db/database.ts";
import type { DashboardOptions } from "./dashboard.ts";
import { snapshotItemsByDay } from "../derive/deuchan.ts";
import { gsmContentAliases } from "../derive/gsm.ts";

interface ContentRow {
  id: string;
  source: string;
  kind: string;
  title: string | null;
  external_id: string | null;
  total_units: number | null;
  unit: string | null;
  meta: string | null;
}

/** The address stored in a content's meta (Deuchan items from any site). */
function urlOf(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const parsed = JSON.parse(meta) as { url?: unknown };
    return typeof parsed.url === "string" ? parsed.url : null;
  } catch {
    return null;
  }
}

interface VideoTotals {
  seconds: number;
  days: Map<string, number>;
}

/**
 * Per Deuchan item (content id): seconds credited, per day, from the newest snapshot of each device
 * and day.
 */
export function videoTotals(db: Database): Map<string, VideoTotals> {
  const totals = new Map<string, VideoTotals>();
  for (const [day, items] of snapshotItemsByDay(db)) {
    for (const item of items) {
      const entry = totals.get(item.contentId) ?? { seconds: 0, days: new Map<string, number>() };
      entry.seconds += item.seconds;
      entry.days.set(day, (entry.days.get(day) ?? 0) + item.seconds);
      totals.set(item.contentId, entry);
    }
  }
  return totals;
}

function minedCounts(db: Database): Map<string, number> {
  return new Map(
    (
      db
        .prepare(
          "SELECT content_id, COUNT(*) AS count FROM cards WHERE content_id IS NOT NULL GROUP BY content_id",
        )
        .all() as { content_id: string; count: number }[]
    ).map((row) => [row.content_id, row.count]),
  );
}

function summarize(
  db: Database,
  options: DashboardOptions,
  rows: ContentRow[],
): (ContentSummary & { row: ContentRow })[] {
  const day = (ts: number) => dayKey(ts, options.timeZone, options.cutoffHour);
  const videos = videoTotals(db);
  const mined = minedCounts(db);
  const stored = new Map(
    (
      db.prepare("SELECT content_id, etag, origin FROM covers").all() as {
        content_id: string;
        etag: string;
        origin: CoverSource;
      }[]
    ).map((row) => [row.content_id, row]),
  );
  // A game read on several computers is one content; its cover may be under another computer's id
  for (const [contentId, others] of gsmContentAliases(db)) {
    if (stored.has(contentId)) continue;
    const found = others.find((other) => stored.has(other));
    if (found) stored.set(contentId, stored.get(found)!);
  }
  const sessions = new Map<
    string,
    { seconds: number; count: number; chars: number; first: number; last: number }
  >();
  for (const row of db
    .prepare(
      `SELECT content_id, SUM(seconds) AS seconds, COUNT(*) AS count, SUM(COALESCE(units, 0)) AS chars,
         MIN(start_ts) AS first, MAX(end_ts) AS last
       FROM sessions WHERE (source = 'gsm' AND language = ?) OR source != 'gsm' GROUP BY content_id`,
    )
    .all(options.targetLanguage) as {
    content_id: string;
    seconds: number;
    count: number;
    chars: number;
    first: number;
    last: number;
  }[]) {
    sessions.set(row.content_id, row);
  }

  return rows.map((row) => {
    const own = sessions.get(row.id);
    const video = row.source === "deuchan" ? videos.get(row.id) : undefined;
    const days = [
      ...(own ? [day(own.first), day(own.last)] : []),
      ...(video ? [...video.days.keys()] : []),
    ].sort();
    return {
      row,
      id: row.id,
      source: row.source,
      kind: row.kind,
      title: row.title,
      // A video's time is Deuchan's: its sessions are part of it, not an addition
      seconds: row.source === "deuchan" ? (video?.seconds ?? own?.seconds ?? 0) : (own?.seconds ?? 0),
      sessions: own?.count ?? 0,
      characters: row.source === "gsm" ? (own?.chars ?? 0) : null,
      cardsMined: mined.get(row.id) ?? 0,
      firstDay: days[0] ?? null,
      lastDay: days.at(-1) ?? null,
      // The version in the URL changes with the image, so a browser never shows an old one
      cover: stored.has(row.id)
        ? `/api/contents/${encodeURIComponent(row.id)}/cover?v=${stored.get(row.id)!.etag.slice(0, 12)}`
        : row.kind === "video" && options.youtubeThumbnails === true
          ? `/api/contents/${encodeURIComponent(row.id)}/cover`
          : null,
      coverSource: stored.get(row.id)?.origin ?? null,
    };
  });
}

export function listContents(db: Database, options: DashboardOptions): ContentsResponse {
  const rows = db
    .prepare("SELECT id, source, kind, title, external_id, total_units, unit, meta FROM contents")
    .all() as unknown as ContentRow[];
  const contents = summarize(db, options, rows)
    .map(({ row: _row, ...summary }) => summary)
    // Contents with nothing in the target language (a test in another language) are left out
    .filter((content) => content.seconds > 0 || content.cardsMined > 0)
    .sort((a, b) => (b.lastDay ?? "").localeCompare(a.lastDay ?? "") || b.seconds - a.seconds);
  return { contents };
}

function minedWords(db: Database, noteIds: number[]): string[] {
  if (noteIds.length === 0) return [];
  return (
    db
      .prepare("SELECT word FROM cards WHERE note_id IN (SELECT value FROM json_each(?)) ORDER BY note_id")
      .all(JSON.stringify(noteIds)) as { word: string | null }[]
  ).map((row) => row.word ?? "?");
}

const parseIds = (value: string | null) => (value ? (JSON.parse(value) as number[]) : []);

export function contentDetail(
  db: Database,
  options: DashboardOptions,
  id: string,
): ContentDetailResponse | null {
  const row = db
    .prepare(
      "SELECT id, source, kind, title, external_id, total_units, unit, meta FROM contents WHERE id = ?",
    )
    .get(id) as ContentRow | undefined;
  if (!row) return null;
  const [summary] = summarize(db, options, [row]);
  const { row: _row, ...content } = summary!;
  const day = (ts: number) => dayKey(ts, options.timeZone, options.cutoffHour);

  const sessions = (
    db
      .prepare(
        "SELECT id, language, start_ts, end_ts, seconds, units, lines FROM sessions WHERE content_id = ? ORDER BY start_ts DESC",
      )
      .all(id) as {
      id: string;
      language: string;
      start_ts: number;
      end_ts: number;
      seconds: number;
      units: number | null;
      lines: number | null;
    }[]
  ).map((session) => ({
    id: session.id,
    language: session.language,
    start: session.start_ts,
    end: session.end_ts,
    seconds: session.seconds,
    characters: session.units,
    lines: session.lines,
  }));

  // Time per day: the reading time of each line (GSM), or what Deuchan credited the video each day
  const days = new Map<string, number>();
  if (row.source === "deuchan") {
    for (const [key, seconds] of videoTotals(db).get(row.id)?.days ?? []) days.set(key, seconds);
  } else {
    for (const line of db
      .prepare(
        `SELECT l.ts, l.seconds FROM lines l JOIN sessions s ON s.id = l.session_id
         WHERE l.content_id = ? AND s.language = ? AND l.seconds > 0`,
      )
      .all(id, options.targetLanguage) as { ts: number; seconds: number }[]) {
      days.set(day(line.ts), (days.get(day(line.ts)) ?? 0) + line.seconds);
    }
  }

  const cards = (
    db
      .prepare(
        `SELECT c.note_id, c.word, c.created_ts, l.text FROM cards c LEFT JOIN lines l ON l.id = c.line_id
         WHERE c.content_id = ? ORDER BY c.created_ts DESC`,
      )
      .all(id) as { note_id: number; word: string | null; created_ts: number; text: string | null }[]
  ).map((card) => ({ noteId: card.note_id, word: card.word, created: card.created_ts, line: card.text }));

  const lines: ContentLine[] = (
    db
      .prepare("SELECT id, ts, text, note_ids FROM lines WHERE content_id = ? ORDER BY ts DESC LIMIT 200")
      .all(id) as { id: string; ts: number; text: string; note_ids: string | null }[]
  ).map((line) => ({
    id: line.id,
    ts: line.ts,
    text: line.text,
    mined: minedWords(db, parseIds(line.note_ids)),
  }));

  const hours = content.seconds / 3600;
  return {
    content: {
      ...content,
      externalId: row.external_id,
      url:
        urlOf(row.meta) ??
        (row.kind === "video" && row.external_id
          ? `https://www.youtube.com/watch?v=${row.external_id}`
          : null),
      totalUnits: row.total_units,
      unit: row.unit,
    },
    // Rule 7: a speed only where it means something, a share only where the length is known
    charactersPerHour:
      row.source === "gsm" && hours > 0 ? Math.round((content.characters ?? 0) / hours) : null,
    completion:
      row.total_units && row.total_units > 0 && content.characters !== null
        ? Math.min(1, content.characters / row.total_units)
        : null,
    days: [...days.entries()]
      .map(([key, seconds]) => ({ day: key, seconds }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    sessions,
    cards,
    lines,
  };
}

export const MIN_QUERY_LENGTH = 3;

/**
 * Searches the sentences read. The index is made of trigrams, so a word is found inside compounds
 * ("wand" in "Einwand"), without case or accents; a search needs three characters at least. The text
 * is searched as a phrase, so quotes or operators typed by the user are just characters.
 */
export function searchLines(
  db: Database,
  options: DashboardOptions,
  query: string,
  { limit = 50, contentId }: { limit?: number; contentId?: string } = {},
): SearchResponse {
  const trimmed = query.trim();
  if ([...trimmed].length < MIN_QUERY_LENGTH) {
    return { query: trimmed, hits: [], more: false };
  }
  const phrase = `"${trimmed.replace(/"/g, '""')}"`;
  const rows = db
    .prepare(
      `SELECT l.id, l.ts, l.text, l.content_id, l.note_ids, c.title
       FROM lines_fts f JOIN lines l ON l.rowid = f.rowid LEFT JOIN contents c ON c.id = l.content_id
       WHERE lines_fts MATCH ? AND (? IS NULL OR l.content_id = ?)
       ORDER BY l.ts DESC LIMIT ?`,
    )
    .all(phrase, contentId ?? null, contentId ?? null, limit + 1) as {
    id: string;
    ts: number;
    text: string;
    content_id: string | null;
    note_ids: string | null;
    title: string | null;
  }[];
  const hits: SearchHit[] = rows.slice(0, limit).map((row) => ({
    id: row.id,
    ts: row.ts,
    text: row.text,
    contentId: row.content_id,
    contentTitle: row.title,
    day: dayKey(row.ts, options.timeZone, options.cutoffHour),
    mined: minedWords(db, parseIds(row.note_ids)),
  }));
  return { query: trimmed, hits, more: rows.length > limit };
}
