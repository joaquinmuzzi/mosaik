/**
 * The Anki connector, in two halves:
 *
 * - `readAnki` asks AnkiConnect for what is new or changed in the configured decks, compared with what
 *   the database already knows (`knownAnki`): notes, cards, removed ones, and reviews after the cursor.
 * - `applyAnki` writes that batch into the raw tables and rebuilds `cards` and `reviews`.
 *
 * In local mode the hub runs both; with a server, an agent reads and the server applies. Every read lists
 * the note and card ids of each deck (cheap), asks Anki for their modification times and fetches only the
 * notes and cards that are new or changed. Reviews are read incrementally per deck, from the last review
 * id seen (the cursor). Nothing is ever written to Anki.
 *
 * Anki's collection is the same on every computer (AnkiWeb syncs it), with the same ids, so its tables
 * have no device: any computer may send Anki, and repeated rows are just upserted again.
 */
import type { AnkiBatch } from "@mosaik/shared";
import type { Database } from "../../db/database.ts";
import { transaction } from "../../db/database.ts";
import { rebuildCards, rebuildReviews } from "../../derive/cards.ts";
import type { Connector, ConnectorResult, JsonValue } from "../types.ts";
import {
  type AnkiClient,
  AnkiConnectError,
  type CardInfo,
  type NoteInfo,
  deckQuery,
  isMissing,
} from "./client.ts";
import { fieldValues } from "./text.ts";

export const ANKI_SOURCE = "anki";

export interface AnkiConnectorOptions {
  db: Database;
  client: AnkiClient;
  /** Decks to read, subdecks included. */
  decks: readonly string[];
  /** Premade decks whose cards count as 'refold-1k'. */
  refoldDecks: readonly string[];
  /** The user's time zone, to match cards with the videos seen the day they were mined. */
  timeZone?: string;
}

export interface AnkiCursor {
  /** Last review id read, per configured deck. */
  reviews: Record<string, number>;
}

export function parseCursor(cursor: JsonValue | null): AnkiCursor {
  const reviews: Record<string, number> = {};
  if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
    const stored = cursor.reviews;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [deck, id] of Object.entries(stored)) {
        if (typeof id === "number" && Number.isInteger(id) && id >= 0) {
          reviews[deck] = id;
        }
      }
    }
  }
  return { reviews };
}

interface KnownRow {
  mod: number;
  deck: string;
  removed: boolean;
}

/** What the database already has of Anki, so a read only fetches what changed. */
export interface AnkiKnown {
  notes: Map<number, KnownRow>;
  cards: Map<number, KnownRow>;
}

function knownRows(db: Database, sql: string): Map<number, KnownRow> {
  const rows = db.prepare(sql).all() as { id: number; mod: number; deck: string; removed: number }[];
  return new Map(rows.map((row) => [row.id, { mod: row.mod, deck: row.deck, removed: row.removed === 1 }]));
}

export function knownAnki(db: Database): AnkiKnown {
  return {
    notes: knownRows(
      db,
      "SELECT note_id AS id, mod, deck, removed_at IS NOT NULL AS removed FROM raw_anki_notes",
    ),
    cards: knownRows(
      db,
      "SELECT card_id AS id, mod, deck, removed_at IS NOT NULL AS removed FROM raw_anki_cards",
    ),
  };
}

/** Whether `deck` is `parent` or one of its subdecks. */
function within(deck: string, parents: Iterable<string>): boolean {
  for (const parent of parents) {
    if (deck === parent || deck.startsWith(`${parent}::`)) {
      return true;
    }
  }
  return false;
}

export interface ReadAnkiOptions {
  client: AnkiClient;
  decks: readonly string[];
  known: AnkiKnown;
  cursor: JsonValue | null;
}

/** Asks Anki for what is new or changed compared with `known` and the cursor. Writes nothing. */
export async function readAnki({ client, decks, known, cursor }: ReadAnkiOptions): Promise<AnkiBatch> {
  const version = await client.version();
  if (version < 6) {
    throw new AnkiConnectError("api", `AnkiConnect version ${version} is too old (6 or newer is needed)`);
  }

  // cardReviews creates a deck that does not exist, so only existing decks are asked for
  const existing = await client.deckNamesAndIds();
  const present = decks.filter((deck) => Object.hasOwn(existing, deck));
  const warnings = decks
    .filter((deck) => !present.includes(deck))
    .map((deck) => `Deck not found in Anki: "${deck}"`);

  // Which configured deck each note and card belongs to (the first one, if decks are nested)
  const noteDeck = new Map<number, string>();
  const cardDeck = new Map<number, string>();
  for (const deck of present) {
    const query = deckQuery(deck);
    for (const id of await client.findNotes(query)) {
      if (!noteDeck.has(id)) noteDeck.set(id, deck);
    }
    for (const id of await client.findCards(query)) {
      if (!cardDeck.has(id)) cardDeck.set(id, deck);
    }
  }

  // Notes and cards that are new or changed since the last run
  const noteMods = await client.notesModTime([...noteDeck.keys()]);
  const changedNoteIds = noteMods
    .filter((entry) => !isMissing(entry))
    .filter(({ noteId, mod }) => {
      const stored = known.notes.get(noteId);
      return !stored || stored.mod !== mod || stored.deck !== noteDeck.get(noteId) || stored.removed;
    })
    .map(({ noteId }) => noteId);
  const notes = (await client.notesInfo(changedNoteIds)).filter((note): note is NoteInfo => !isMissing(note));

  const cardMods = await client.cardsModTime([...cardDeck.keys()]);
  const changedCardIds = cardMods
    .filter((entry) => !isMissing(entry))
    .filter(({ cardId, mod }) => {
      const stored = known.cards.get(cardId);
      return !stored || stored.mod !== mod || stored.removed;
    })
    .map(({ cardId }) => cardId);
  const cards = (await client.cardsInfo(changedCardIds)).filter((card): card is CardInfo => !isMissing(card));

  // A card seen for the first time that was already reviewed (moved in from another deck) has
  // reviews older than the cursor: that deck is read again from the start
  const previous = parseCursor(cursor);
  const rereadDecks = new Set(
    cards
      .filter((card) => !known.cards.has(card.cardId) && card.reps > 0)
      .map((card) => cardDeck.get(card.cardId))
      .filter((deck): deck is string => deck !== undefined),
  );
  const reviews: AnkiBatch["reviews"] = [];
  for (const deck of present) {
    const start = rereadDecks.has(deck) ? 0 : (previous.reviews[deck] ?? 0);
    reviews.push({ deck, rows: await client.cardReviews(deck, start) });
  }

  // Notes and cards that left the decks read this run. Those of a deck that was not found keep
  // their state: a renamed deck must not look like everything was deleted.
  const removedNotes = [...known.notes]
    .filter(([id, row]) => !row.removed && !noteDeck.has(id) && within(row.deck, present))
    .map(([id]) => id);
  const removedCards = [...known.cards]
    .filter(([id, row]) => !row.removed && !cardDeck.has(id) && within(row.deck, present))
    .map(([id]) => id);

  return {
    source: "anki",
    version: 1,
    presentDecks: present,
    warnings,
    notes: notes.map((note) => ({ deck: noteDeck.get(note.noteId) ?? "", note })),
    cards,
    removedNotes,
    removedCards,
    reviews,
  };
}

export interface ApplyAnkiOptions {
  /** The cursor saved after the last batch. */
  cursor: JsonValue | null;
  refoldDecks: readonly string[];
  timeZone?: string;
  now: number;
}

/** Writes a batch into the database. Applying the same batch twice writes nothing new. */
export function applyAnki(
  db: Database,
  batch: AnkiBatch,
  { cursor, refoldDecks, timeZone, now }: ApplyAnkiOptions,
): ConnectorResult {
  const previous = parseCursor(cursor);
  let reviewsNew = 0;
  const nextCursor: AnkiCursor = { reviews: { ...previous.reviews } };
  const totals = transaction(db, () => {
    const upsertNote = db.prepare(
      `INSERT INTO raw_anki_notes (note_id, model, deck, fields, tags, mod, payload, synced_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (note_id) DO UPDATE SET model = excluded.model, deck = excluded.deck,
         fields = excluded.fields, tags = excluded.tags, mod = excluded.mod, payload = excluded.payload,
         synced_at = excluded.synced_at, removed_at = NULL`,
    );
    for (const { deck, note } of batch.notes) {
      upsertNote.run(
        note.noteId,
        note.modelName,
        deck,
        JSON.stringify(fieldValues(note.fields)),
        JSON.stringify(note.tags),
        note.mod,
        JSON.stringify(note),
        now,
      );
    }

    const upsertCard = db.prepare(
      `INSERT INTO raw_anki_cards (card_id, note_id, deck, type, queue, interval, due, reps, lapses, mod,
         payload, synced_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (card_id) DO UPDATE SET note_id = excluded.note_id, deck = excluded.deck,
         type = excluded.type, queue = excluded.queue, interval = excluded.interval, due = excluded.due,
         reps = excluded.reps, lapses = excluded.lapses, mod = excluded.mod, payload = excluded.payload,
         synced_at = excluded.synced_at, removed_at = NULL`,
    );
    for (const card of batch.cards) {
      upsertCard.run(
        card.cardId,
        card.note,
        card.deckName,
        card.type,
        card.queue,
        card.interval,
        card.due,
        card.reps,
        card.lapses,
        card.mod,
        JSON.stringify(card),
        now,
      );
    }

    const markNote = db.prepare("UPDATE raw_anki_notes SET removed_at = ? WHERE note_id = ?");
    for (const id of batch.removedNotes) markNote.run(now, id);
    const markCard = db.prepare("UPDATE raw_anki_cards SET removed_at = ? WHERE card_id = ?");
    for (const id of batch.removedCards) markCard.run(now, id);

    const exists = db.prepare("SELECT 1 FROM raw_anki_reviews WHERE review_id = ?");
    const upsertReview = db.prepare(
      `INSERT INTO raw_anki_reviews (review_id, card_id, usn, ease, ivl, last_ivl, factor, time_ms, type, deck)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (review_id) DO UPDATE SET card_id = excluded.card_id, usn = excluded.usn,
         ease = excluded.ease, ivl = excluded.ivl, last_ivl = excluded.last_ivl, factor = excluded.factor,
         time_ms = excluded.time_ms, type = excluded.type, deck = excluded.deck`,
    );
    for (const { deck, rows } of batch.reviews) {
      let last = nextCursor.reviews[deck] ?? 0;
      for (const [id, cid, usn, ease, ivl, lastIvl, factor, time, type] of rows) {
        if (!exists.get(id)) reviewsNew += 1;
        upsertReview.run(id, cid, usn, ease, ivl, lastIvl, factor, time, type, deck);
        last = Math.max(last, id);
      }
      nextCursor.reviews[deck] = last;
    }

    return {
      cards: rebuildCards(db, timeZone === undefined ? { refoldDecks } : { refoldDecks, timeZone }),
      reviews: rebuildReviews(db),
    };
  });

  const unknown = db.prepare("SELECT COUNT(*) AS count FROM cards WHERE origin = 'unknown'").get() as {
    count: number;
  };
  const summary: Record<string, JsonValue> = {
    notes: totals.cards,
    notesUpdated: batch.notes.length,
    notesRemoved: batch.removedNotes.length,
    cardsUpdated: batch.cards.length,
    cardsRemoved: batch.removedCards.length,
    reviews: totals.reviews,
    reviewsNew,
    unknownOrigin: unknown.count,
  };
  if (batch.warnings.length > 0) {
    summary.warnings = batch.warnings;
  }
  return { cursor: { reviews: nextCursor.reviews }, summary };
}

/** Local mode: read Anki and apply it right away. */
export function createAnkiConnector({
  db,
  client,
  decks,
  refoldDecks,
  timeZone,
}: AnkiConnectorOptions): Connector {
  return {
    source: ANKI_SOURCE,

    async run({ cursor, now, log }): Promise<ConnectorResult> {
      const batch = await readAnki({ client, decks, known: knownAnki(db), cursor });
      for (const warning of batch.warnings) {
        log.warn({ source: ANKI_SOURCE }, warning);
      }
      return applyAnki(db, batch, {
        cursor,
        refoldDecks,
        now: now(),
        ...(timeZone === undefined ? {} : { timeZone }),
      });
    },
  };
}
