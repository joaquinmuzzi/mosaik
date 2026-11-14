/**
 * The Anki connector: copies the notes, cards and reviews of the configured decks into the raw
 * tables, then rebuilds `cards` and `reviews`.
 *
 * Every run lists the note and card ids of each deck (cheap), asks Anki for their modification times
 * and fetches only the notes and cards that are new or changed. Reviews are read incrementally per
 * deck, from the last review id seen (the cursor). Nothing is ever written to Anki.
 */
import type { Database } from "../../db/database.ts";
import { transaction } from "../../db/database.ts";
import { rebuildCards, rebuildReviews } from "../../derive/cards.ts";
import type { Connector, ConnectorResult, JsonValue } from "../types.ts";
import {
  type AnkiClient,
  AnkiConnectError,
  type CardInfo,
  type NoteInfo,
  type ReviewRow,
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

interface StoredRow {
  id: number;
  mod: number;
  deck: string;
  removed: number;
}

function storedRows(db: Database, sql: string): Map<number, StoredRow> {
  const rows = db.prepare(sql).all() as unknown as StoredRow[];
  return new Map(rows.map((row) => [row.id, row]));
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
      const storedNotes = storedRows(
        db,
        "SELECT note_id AS id, mod, deck, removed_at IS NOT NULL AS removed FROM raw_anki_notes",
      );
      const noteMods = await client.notesModTime([...noteDeck.keys()]);
      const changedNoteIds = noteMods
        .filter((entry) => !isMissing(entry))
        .filter(({ noteId, mod }) => {
          const stored = storedNotes.get(noteId);
          return (
            !stored || stored.mod !== mod || stored.deck !== noteDeck.get(noteId) || stored.removed === 1
          );
        })
        .map(({ noteId }) => noteId);
      const notes = (await client.notesInfo(changedNoteIds)).filter(
        (note): note is NoteInfo => !isMissing(note),
      );

      const storedCards = storedRows(
        db,
        "SELECT card_id AS id, mod, deck, removed_at IS NOT NULL AS removed FROM raw_anki_cards",
      );
      const cardMods = await client.cardsModTime([...cardDeck.keys()]);
      const changedCardIds = cardMods
        .filter((entry) => !isMissing(entry))
        .filter(({ cardId, mod }) => {
          const stored = storedCards.get(cardId);
          return !stored || stored.mod !== mod || stored.removed === 1;
        })
        .map(({ cardId }) => cardId);
      const cards = (await client.cardsInfo(changedCardIds)).filter(
        (card): card is CardInfo => !isMissing(card),
      );

      // A card seen for the first time that was already reviewed (moved in from another deck) has
      // reviews older than the cursor: that deck is read again from the start
      const previous = parseCursor(cursor);
      const rereadDecks = new Set(
        cards
          .filter((card) => !storedCards.has(card.cardId) && card.reps > 0)
          .map((card) => cardDeck.get(card.cardId))
          .filter((deck): deck is string => deck !== undefined),
      );
      const reviewsByDeck = new Map<string, ReviewRow[]>();
      for (const deck of present) {
        const start = rereadDecks.has(deck) ? 0 : (previous.reviews[deck] ?? 0);
        reviewsByDeck.set(deck, await client.cardReviews(deck, start));
      }

      // Notes and cards that left the decks read this run. Those of a deck that was not found keep
      // their state: a renamed deck must not look like everything was deleted.
      const syncedAt = now();
      const removedNotes = [...storedNotes.values()]
        .filter((row) => row.removed === 0 && !noteDeck.has(row.id) && within(row.deck, present))
        .map((row) => row.id);
      const removedCards = [...storedCards.values()]
        .filter((row) => row.removed === 0 && !cardDeck.has(row.id) && within(row.deck, present))
        .map((row) => row.id);

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
        for (const note of notes) {
          upsertNote.run(
            note.noteId,
            note.modelName,
            noteDeck.get(note.noteId) ?? "",
            JSON.stringify(fieldValues(note.fields)),
            JSON.stringify(note.tags),
            note.mod,
            JSON.stringify(note),
            syncedAt,
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
        for (const card of cards) {
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
            syncedAt,
          );
        }

        const markNote = db.prepare("UPDATE raw_anki_notes SET removed_at = ? WHERE note_id = ?");
        for (const id of removedNotes) markNote.run(syncedAt, id);
        const markCard = db.prepare("UPDATE raw_anki_cards SET removed_at = ? WHERE card_id = ?");
        for (const id of removedCards) markCard.run(syncedAt, id);

        const exists = db.prepare("SELECT 1 FROM raw_anki_reviews WHERE review_id = ?");
        const upsertReview = db.prepare(
          `INSERT INTO raw_anki_reviews (review_id, card_id, usn, ease, ivl, last_ivl, factor, time_ms, type, deck)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (review_id) DO UPDATE SET card_id = excluded.card_id, usn = excluded.usn,
             ease = excluded.ease, ivl = excluded.ivl, last_ivl = excluded.last_ivl, factor = excluded.factor,
             time_ms = excluded.time_ms, type = excluded.type, deck = excluded.deck`,
        );
        for (const [deck, rows] of reviewsByDeck) {
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
      for (const warning of warnings) {
        log.warn({ source: ANKI_SOURCE }, warning);
      }

      const summary: Record<string, JsonValue> = {
        notes: totals.cards,
        notesUpdated: notes.length,
        notesRemoved: removedNotes.length,
        cardsUpdated: cards.length,
        cardsRemoved: removedCards.length,
        reviews: totals.reviews,
        reviewsNew,
        unknownOrigin: unknown.count,
      };
      if (warnings.length > 0) {
        summary.warnings = warnings;
      }
      return { cursor: { reviews: nextCursor.reviews }, summary };
    },
  };
}
