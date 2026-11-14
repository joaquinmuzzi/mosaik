/**
 * Builds the common `cards` and `reviews` tables from the raw Anki tables. Everything here can be
 * thrown away and rebuilt: the raw tables are the truth.
 *
 * The origin of a card is decided by these rules, in order (docs/plan.md, section 3):
 *   1. its note id is in the `note_ids` of a GameSentenceMiner line → 'gsm'      (phase 2)
 *   2. it has a URL field with a YouTube video → 'youtube'                        (phase 3)
 *   3. its source title matches a Deuchan video of the same day → 'youtube'       (phase 3)
 *   4. it is in a premade deck (Refold) → 'refold-1k'
 *   5. otherwise 'unknown', counted so the rules can be improved
 */
import { sourceTitleOf, wordOf } from "../connectors/anki/text.ts";
import type { Database } from "../db/database.ts";

export type CardOrigin = "gsm" | "youtube" | "refold-1k" | "unknown";

export interface Attribution {
  origin: CardOrigin;
  contentId: string | null;
  lineId: string | null;
}

export interface AttributionInput {
  deck: string;
}

export interface AttributionOptions {
  refoldDecks: readonly string[];
}

/** Whether `deck` is one of `decks` or one of their subdecks. */
function inDecks(deck: string, decks: readonly string[]): boolean {
  return decks.some((parent) => deck === parent || deck.startsWith(`${parent}::`));
}

export function attributeOrigin(input: AttributionInput, options: AttributionOptions): Attribution {
  if (inDecks(input.deck, options.refoldDecks)) {
    return { origin: "refold-1k", contentId: null, lineId: null };
  }
  return { origin: "unknown", contentId: null, lineId: null };
}

interface RawNoteRow {
  note_id: number;
  model: string;
  deck: string;
  fields: string;
}

/** Rebuilds `cards` from the notes still present in Anki. Call it inside a transaction. */
export function rebuildCards(db: Database, options: AttributionOptions): number {
  db.exec("DELETE FROM cards");
  const insert = db.prepare(
    `INSERT INTO cards (note_id, word, deck, model, origin, content_id, line_id, source_title, created_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows = db
    .prepare("SELECT note_id, model, deck, fields FROM raw_anki_notes WHERE removed_at IS NULL")
    .all() as unknown as RawNoteRow[];
  for (const row of rows) {
    const values = JSON.parse(row.fields) as Record<string, string>;
    const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
    const { origin, contentId, lineId } = attributeOrigin({ deck: row.deck }, options);
    insert.run(
      row.note_id,
      wordOf(row.model, fields),
      row.deck,
      row.model,
      origin,
      contentId,
      lineId,
      sourceTitleOf(fields),
      // Anki's note id is the time the note was created
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
