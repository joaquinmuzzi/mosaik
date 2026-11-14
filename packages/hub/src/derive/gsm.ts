/**
 * Builds the GSM rows of `contents`, `sessions` and `lines` (and the sentence search) from the raw
 * GSM tables. Everything here can be thrown away and rebuilt.
 *
 * Each game's lines go through GSM's reading-time algorithm (see connectors/gsm/reading-time.ts):
 * its sessions become `sessions`, and the time it credits to each line is kept in `lines.seconds`, so
 * the time of a day is the sum of its lines' time, whatever hour the day starts at.
 */
import {
  type StatsTextOptions,
  cleanTextForStats,
  countCharacters,
  readingTimeline,
} from "../connectors/gsm/reading-time.ts";
import type { Database } from "../db/database.ts";

export const GSM_SOURCE = "gsm";

export interface GsmDeriveOptions {
  sessionGapSeconds: number;
  text: StatsTextOptions;
}

/** The content a GSM line belongs to: its game, or its scene name when GSM linked no game. */
export function gsmContentId(gameId: string | null, gameName: string | null): string {
  return gameId && gameId.trim() !== "" ? `gsm:${gameId}` : `gsm-name:${gameName ?? ""}`;
}

/** Note ids from GSM's `note_ids` column (a JSON list of strings or numbers). */
export function parseNoteIds(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0)
      : [];
  } catch {
    return [];
  }
}

interface RawLine {
  id: string;
  game_id: string | null;
  game_name: string | null;
  line_text: string | null;
  timestamp: number;
  language: string | null;
  note_ids: string | null;
}

interface GameRow {
  id: string;
  payload: string;
}

/** The most frequent value; ties go to the first one seen. */
function mostFrequent(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (best === null || count > counts.get(best)!) best = value;
  }
  return best;
}

function titleOf(game: Record<string, unknown>): string | null {
  for (const key of ["title_original", "title_english", "title_romaji", "obs_scene_name"]) {
    const value = game[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export interface GsmDeriveResult {
  contents: number;
  sessions: number;
  lines: number;
  seconds: number;
}

/** Rebuilds the GSM rows of the common model. Call it inside a transaction. */
export function rebuildGsm(db: Database, { sessionGapSeconds, text }: GsmDeriveOptions): GsmDeriveResult {
  db.prepare("DELETE FROM lines WHERE source = ?").run(GSM_SOURCE);
  db.prepare("DELETE FROM sessions WHERE source = ?").run(GSM_SOURCE);
  db.prepare("DELETE FROM contents WHERE source = ?").run(GSM_SOURCE);

  const games = db.prepare("SELECT id, payload FROM raw_gsm_games").all() as unknown as GameRow[];
  const breaks = (
    db.prepare("SELECT timestamp FROM raw_gsm_breaks ORDER BY timestamp").all() as { timestamp: number }[]
  ).map((row) => row.timestamp);
  const raw = db
    .prepare(
      `SELECT id, game_id, game_name, line_text, timestamp, language, note_ids
       FROM raw_gsm_lines WHERE removed_at IS NULL ORDER BY timestamp`,
    )
    .all() as unknown as RawLine[];

  // Contents: GSM's games, and the scenes of lines that have none
  const insertContent = db.prepare(
    `INSERT INTO contents (id, source, kind, title, external_id, parent_id, total_units, unit, meta)
     VALUES (?, ?, 'game', ?, ?, NULL, ?, 'characters', ?)
     ON CONFLICT (id) DO NOTHING`,
  );
  for (const { id, payload } of games) {
    const game = JSON.parse(payload) as Record<string, unknown>;
    const total = Number(game.character_count);
    insertContent.run(
      gsmContentId(id, null),
      GSM_SOURCE,
      titleOf(game),
      id,
      Number.isSafeInteger(total) && total > 0 ? total : null,
      JSON.stringify({
        type: game.type || null,
        completed: game.completed === "1" || game.completed === 1 || game.completed === "true",
        genres: game.genres ?? null,
        tags: game.tags ?? null,
      }),
    );
  }

  const byContent = new Map<string, (RawLine & { chars: number })[]>();
  for (const line of raw) {
    const contentId = gsmContentId(line.game_id, line.game_name);
    const chars = countCharacters(cleanTextForStats(line.line_text, text));
    let group = byContent.get(contentId);
    if (!group) {
      group = [];
      byContent.set(contentId, group);
      insertContent.run(
        contentId,
        GSM_SOURCE,
        line.game_name,
        line.game_id || null,
        null,
        JSON.stringify({}),
      );
    }
    group.push({ ...line, chars });
  }

  const insertSession = db.prepare(
    `INSERT INTO sessions (id, source, medium, language, content_id, start_ts, end_ts, seconds, units, unit, lines)
     VALUES (?, ?, 'game', ?, ?, ?, ?, ?, ?, 'characters', ?)`,
  );
  const insertLine = db.prepare(
    `INSERT INTO lines (id, source, content_id, session_id, ts, text, language, chars, seconds, note_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let sessionCount = 0;
  let totalSeconds = 0;
  for (const [contentId, group] of byContent) {
    const timeline = readingTimeline(group, { sessionGapSeconds, breaks });
    for (const session of timeline.sessions) {
      const sessionLines = timeline.lines.slice(session.first, session.last + 1);
      const first = sessionLines[0]!;
      const last = sessionLines.at(-1)!;
      const sessionId = `gsm:${first.id}`;
      insertSession.run(
        sessionId,
        GSM_SOURCE,
        // GSM records its language setting per line; the session takes the most frequent one
        mostFrequent(sessionLines.map((line) => line.language)) ?? "und",
        contentId,
        Math.round(first.timestamp * 1000),
        Math.round(last.timestamp * 1000),
        session.seconds,
        sessionLines.reduce((sum, line) => sum + line.chars, 0),
        sessionLines.length,
      );
      sessionCount += 1;
      totalSeconds += session.seconds;
      for (let offset = 0; offset < sessionLines.length; offset += 1) {
        const line = sessionLines[offset]!;
        const noteIds = parseNoteIds(line.note_ids);
        insertLine.run(
          `gsm:${line.id}`,
          GSM_SOURCE,
          contentId,
          sessionId,
          Math.round(line.timestamp * 1000),
          line.line_text ?? "",
          line.language,
          line.chars,
          timeline.credits[session.first + offset]!,
          noteIds.length > 0 ? JSON.stringify(noteIds) : null,
        );
      }
    }
  }

  // The search index follows the lines table it points to
  db.exec("INSERT INTO lines_fts (lines_fts) VALUES ('rebuild')");

  const contents = (
    db.prepare("SELECT COUNT(*) AS count FROM contents WHERE source = ?").get(GSM_SOURCE) as { count: number }
  ).count;
  return { contents, sessions: sessionCount, lines: raw.length, seconds: totalSeconds };
}
