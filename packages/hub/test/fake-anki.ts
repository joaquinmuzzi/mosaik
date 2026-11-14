/**
 * An in-memory Anki that answers AnkiConnect requests the way the user's AnkiConnect does (shapes
 * captured on 2026-11-14), through a fake `fetch`. Tests change the collection between runs and
 * read `actions` to see what the connector asked for.
 *
 * Like the real one, `cardReviews` creates the deck it is asked about when it does not exist, so a
 * test can prove the connector never does that.
 */
import { readFileSync } from "node:fs";

export type ReviewRow = [number, number, number, number, number, number, number, number, number];

export interface FakeNote {
  noteId: number;
  profile: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  modelName: string;
  mod: number;
  cards: number[];
  deck: string;
}

export type FakeCard = Record<string, unknown> & {
  cardId: number;
  note: number;
  deckName: string;
  mod: number;
};

interface Collection {
  decks: Record<string, number>;
  notes: FakeNote[];
  cards: FakeCard[];
  reviews: ReviewRow[];
}

export interface LoggedAction {
  action: string;
  params: Record<string, unknown> | undefined;
}

const FIXTURE = new URL("./fixtures/anki/collection.json", import.meta.url);

/** Anki's day: the user's zone (Buenos Aires, UTC-3, no DST) with a 4:00 cutoff. */
function ankiDay(ms: number): string {
  return new Date(ms - 3 * 3_600_000 - 4 * 3_600_000).toISOString().slice(0, 10);
}

function inDeck(cardDeck: string, deck: string): boolean {
  return cardDeck === deck || cardDeck.startsWith(`${deck}::`);
}

export class FakeAnki {
  decks: Record<string, number>;
  notes: Map<number, FakeNote>;
  cards: Map<number, FakeCard>;
  reviews: ReviewRow[];
  actions: LoggedAction[] = [];
  createdDecks: string[] = [];
  /** While true, every request fails as if Anki were closed. */
  closed = false;

  constructor() {
    const collection = JSON.parse(readFileSync(FIXTURE, "utf8")) as Collection;
    this.decks = { ...collection.decks };
    this.notes = new Map(collection.notes.map((note) => [note.noteId, structuredClone(note)]));
    this.cards = new Map(collection.cards.map((card) => [card.cardId, structuredClone(card)]));
    this.reviews = collection.reviews.map((row) => [...row] as ReviewRow);
  }

  /** Actions received since the last call, and forgets them. */
  takeActions(): LoggedAction[] {
    const taken = this.actions;
    this.actions = [];
    return taken;
  }

  readonly fetch: typeof fetch = async (_input, init) => {
    if (this.closed) {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8765") });
    }
    const request = JSON.parse(String(init?.body)) as {
      action: string;
      version: number;
      params?: Record<string, unknown>;
    };
    this.actions.push({ action: request.action, params: request.params });
    let body: { result: unknown; error: string | null };
    try {
      body = { result: this.answer(request.action, request.params ?? {}), error: null };
    } catch (error) {
      body = { result: null, error: error instanceof Error ? error.message : String(error) };
    }
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };

  private notesMatching(query: string): FakeNote[] {
    const match = /^deck:"((?:[^"\\]|\\.)*)"$/.exec(query);
    if (!match) {
      throw new Error(`fake Anki only understands deck:"…" queries, got ${query}`);
    }
    // Unescape the search syntax
    const deck = match[1]!.replace(/\\(.)/g, "$1");
    return [...this.notes.values()].filter((note) =>
      note.cards.some((id) => {
        const card = this.cards.get(id);
        return card !== undefined && inDeck(card.deckName, deck);
      }),
    );
  }

  private answer(action: string, params: Record<string, unknown>): unknown {
    switch (action) {
      case "version":
        return 6;
      case "deckNamesAndIds":
        return { ...this.decks };
      case "findNotes":
        return this.notesMatching(String(params.query)).map((note) => note.noteId);
      case "findCards":
        return this.notesMatching(String(params.query))
          .flatMap((note) => note.cards)
          .filter((id) => {
            const card = this.cards.get(id);
            const deck = /^deck:"(.*)"$/.exec(String(params.query))![1]!.replace(/\\(.)/g, "$1");
            return card !== undefined && inDeck(card.deckName, deck);
          });
      case "notesInfo":
        return (params.notes as number[]).map((id) => {
          const note = this.notes.get(id);
          if (!note) return {};
          const { deck: _deck, ...info } = note;
          return structuredClone(info);
        });
      case "notesModTime":
        return (params.notes as number[]).map((id) => {
          const note = this.notes.get(id);
          return note ? { noteId: id, mod: note.mod } : {};
        });
      case "cardsInfo": {
        const fields = params.fields as string[] | undefined;
        return (params.cards as number[]).map((id) => {
          const card = this.cards.get(id);
          if (!card) return {};
          return fields
            ? Object.fromEntries(fields.filter((key) => key in card).map((key) => [key, card[key]]))
            : card;
        });
      }
      case "cardsModTime":
        return (params.cards as number[]).map((id) => {
          const card = this.cards.get(id);
          return card ? { cardId: id, mod: card.mod } : {};
        });
      case "cardReviews": {
        const deck = String(params.deck);
        if (!Object.hasOwn(this.decks, deck)) {
          // What the real AnkiConnect does
          this.decks[deck] = Date.now();
          this.createdDecks.push(deck);
        }
        const startId = Number(params.startID ?? 0);
        return this.reviews.filter(([id, cid]) => {
          const card = this.cards.get(cid);
          return id > startId && card !== undefined && inDeck(card.deckName, deck);
        });
      }
      case "getNumCardsReviewedByDay": {
        // The whole collection, deleted cards included, without manual (4) and rescheduled (5) entries
        const counts = new Map<string, number>();
        for (const [id, , , , , , , , type] of this.reviews) {
          if (type <= 3) counts.set(ankiDay(id), (counts.get(ankiDay(id)) ?? 0) + 1);
        }
        return [...counts.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
      }
      default:
        throw new Error("unsupported action");
    }
  }

  // Changes to the collection, as the user would make them in Anki

  addReview(row: ReviewRow): void {
    this.reviews.push(row);
    const card = this.cards.get(row[1]);
    if (card) {
      card.mod = Math.floor(row[0] / 1000);
      card.reps = Number(card.reps) + 1;
    }
  }

  editField(noteId: number, field: string, value: string, modSeconds: number): void {
    const note = this.notes.get(noteId)!;
    note.fields[field]!.value = value;
    note.mod = modSeconds;
  }

  deleteNote(noteId: number): void {
    const note = this.notes.get(noteId)!;
    for (const id of note.cards) this.cards.delete(id);
    this.notes.delete(noteId);
  }

  moveCard(cardId: number, deck: string, modSeconds: number): void {
    const card = this.cards.get(cardId)!;
    card.deckName = deck;
    card.mod = modSeconds;
  }

  renameDeck(from: string, to: string): void {
    this.decks[to] = this.decks[from]!;
    delete this.decks[from];
    for (const card of this.cards.values()) {
      if (card.deckName === from) card.deckName = to;
    }
  }
}
