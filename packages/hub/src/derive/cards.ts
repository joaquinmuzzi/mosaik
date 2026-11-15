/**
 * Builds the common `cards` and `reviews` tables from the raw tables. Everything here can be thrown
 * away and rebuilt: the raw tables are the truth.
 *
 * The origin of a card is decided by these rules, in order (docs/plan.md, section 3):
 *   1. its note id is in the `note_ids` of a GameSentenceMiner line → 'gsm', with the line
 *      1b. otherwise, it has GSM's own `GSM` tag → 'gsm', with the game whose title matches its source
 *   2. it has a URL field with a YouTube video → 'youtube', with that video
 *   3. its source title is the title of a video Deuchan saw that day (or the day before, for cards
 *      mined just after midnight) → 'youtube', with that video
 *   4. it is in a premade deck (Refold) → 'refold-1k'
 *   5. otherwise 'unknown', counted so the rules can be improved
 */
import { dayKey } from "@mosaik/shared";
import { sourceTitleOf, wordOf } from "../connectors/anki/text.ts";
import type { Database } from "../db/database.ts";
import { deuchanTitlesByDay, normalizeTitle, videoContentId, youtubeVideoIdOf } from "./deuchan.ts";
import { gsmContentFor, gsmGameAliases, parseNoteIds } from "./gsm.ts";

export type CardOrigin = "gsm" | "youtube" | "refold-1k" | "unknown";

export interface Attribution {
  origin: CardOrigin;
  contentId: string | null;
  lineId: string | null;
}

export interface AttributionInput {
  noteId: number;
  deck: string;
  tags: readonly string[];
  /** Where the note says it came from, cleaned (see `sourceTitleOf`). */
  sourceTitle: string | null;
  /** The YouTube video in the note's URL field, if it has one. */
  videoId?: string | null;
  /** Local calendar days to look for the source title in: the note's day and the one before. */
  days?: readonly string[];
}

export interface AttributionOptions {
  refoldDecks: readonly string[];
  /** The user's time zone, to know on which day a note was mined. */
  timeZone?: string;
}

/** What the other sources say about where notes were mined. */
export interface AttributionContext {
  /** Note id → the GSM line it was mined from. */
  gsmLines: ReadonlyMap<number, { contentId: string; lineId: string }>;
  /** Lowercased title → GSM content. */
  gsmTitles: ReadonlyMap<string, string>;
  /** Day → normalized video title → video content, from Deuchan. */
  videoTitles: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export const EMPTY_CONTEXT: AttributionContext = {
  gsmLines: new Map(),
  gsmTitles: new Map(),
  videoTitles: new Map(),
};

/** Field names that hold the page a note was mined from. */
const URL_FIELDS = /^(url|source ?url|link|video ?url)$/i;

/** Whether `deck` is one of `decks` or one of their subdecks. */
function inDecks(deck: string, decks: readonly string[]): boolean {
  return decks.some((parent) => deck === parent || deck.startsWith(`${parent}::`));
}

export function attributeOrigin(
  input: AttributionInput,
  options: AttributionOptions,
  context: AttributionContext = EMPTY_CONTEXT,
): Attribution {
  const line = context.gsmLines.get(input.noteId);
  if (line) {
    return { origin: "gsm", contentId: line.contentId, lineId: line.lineId };
  }
  // GSM tags the notes it mines with "GSM" (and "Game::<name>"), and writes the game in MiscInfo
  if (input.tags.some((tag) => tag.toLowerCase() === "gsm")) {
    const contentId = input.sourceTitle
      ? (context.gsmTitles.get(input.sourceTitle.toLowerCase()) ?? null)
      : null;
    return { origin: "gsm", contentId, lineId: null };
  }
  if (input.videoId) {
    return { origin: "youtube", contentId: videoContentId(input.videoId), lineId: null };
  }
  if (input.sourceTitle) {
    const title = normalizeTitle(input.sourceTitle);
    for (const day of input.days ?? []) {
      const contentId = context.videoTitles.get(day)?.get(title);
      if (contentId) return { origin: "youtube", contentId, lineId: null };
    }
  }
  if (inDecks(input.deck, options.refoldDecks)) {
    return { origin: "refold-1k", contentId: null, lineId: null };
  }
  return { origin: "unknown", contentId: null, lineId: null };
}

/** Reads what GSM and Deuchan know about where notes were mined. */
export function loadAttributionContext(db: Database, timeZone: string): AttributionContext {
  const gsmLines = new Map<number, { contentId: string; lineId: string }>();
  const aliases = gsmGameAliases(db);
  const rows = db
    .prepare(
      `SELECT id, game_id, game_name, note_ids FROM raw_gsm_lines
       WHERE removed_at IS NULL AND note_ids IS NOT NULL AND note_ids NOT IN ('', '[]')
       ORDER BY timestamp`,
    )
    .all() as { id: string; game_id: string | null; game_name: string | null; note_ids: string }[];
  for (const row of rows) {
    for (const noteId of parseNoteIds(row.note_ids)) {
      // The first line a note was mined from wins
      if (!gsmLines.has(noteId)) {
        gsmLines.set(noteId, {
          contentId: gsmContentFor(aliases, row.game_id, row.game_name),
          lineId: `gsm:${row.id}`,
        });
      }
    }
  }
  const gsmTitles = new Map<string, string>();
  for (const { id, title } of db
    .prepare("SELECT id, title FROM contents WHERE source = 'gsm' AND title IS NOT NULL")
    .all() as { id: string; title: string }[]) {
    gsmTitles.set(title.toLowerCase(), id);
  }
  return { gsmLines, gsmTitles, videoTitles: deuchanTitlesByDay(db, timeZone) };
}

interface RawNoteRow {
  note_id: number;
  model: string;
  deck: string;
  fields: string;
  tags: string;
}

/** Rebuilds `cards` from the notes still present in Anki. Call it inside a transaction. */
export function rebuildCards(db: Database, options: AttributionOptions): number {
  const timeZone = options.timeZone ?? "UTC";
  const context = loadAttributionContext(db, timeZone);
  db.exec("DELETE FROM cards");
  const insert = db.prepare(
    `INSERT INTO cards (note_id, word, deck, model, origin, content_id, line_id, source_title, created_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = db
    .prepare("SELECT note_id, model, deck, fields, tags FROM raw_anki_notes WHERE removed_at IS NULL")
    .all() as unknown as RawNoteRow[];
  for (const row of rows) {
    const values = JSON.parse(row.fields) as Record<string, string>;
    const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
    const sourceTitle = sourceTitleOf(fields);
    const tags = JSON.parse(row.tags) as string[];
    const urlField = Object.entries(values).find(([name]) => URL_FIELDS.test(name.trim()));
    const { origin, contentId, lineId } = attributeOrigin(
      {
        noteId: row.note_id,
        deck: row.deck,
        tags,
        sourceTitle,
        videoId: urlField ? youtubeVideoIdOf(urlField[1]) : null,
        // Anki's note id is the time the note was created
        days: [dayKey(row.note_id, timeZone, 0), dayKey(row.note_id - 86_400_000, timeZone, 0)],
      },
      options,
      context,
    );
    insert.run(
      row.note_id,
      wordOf(row.model, fields),
      row.deck,
      row.model,
      origin,
      contentId,
      lineId,
      sourceTitle,
      row.note_id,
    );
  }
  return rows.length;
}

/**
 * Rebuilds `reviews` from every review read, including those of cards that were deleted since:
 * they happened. Call it inside a transaction.
 */
export function rebuildReviews(db: Database): number {
  db.exec("DELETE FROM reviews");
  const result = db
    .prepare(
      `INSERT INTO reviews (review_id, note_id, card_id, ts, ease, ivl, last_ivl, type, time_ms)
       SELECT r.review_id, c.note_id, r.card_id, r.review_id, r.ease, r.ivl, r.last_ivl, r.type, r.time_ms
       FROM raw_anki_reviews r LEFT JOIN raw_anki_cards c ON c.card_id = r.card_id`,
    )
    .run();
  return Number(result.changes);
}
