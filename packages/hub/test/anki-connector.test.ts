import { afterEach, describe, expect, it } from "vitest";
import { READ_ACTIONS, createAnkiClient } from "../src/connectors/anki/client.ts";
import { ANKI_SOURCE, createAnkiConnector, parseCursor } from "../src/connectors/anki/connector.ts";
import { getConnectorState } from "../src/connectors/state.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { attributeOrigin } from "../src/derive/cards.ts";
import { compareReviewsPerDay, reviewsPerDay } from "../src/metrics/reviews.ts";
import { createScheduler } from "../src/scheduler.ts";
import { FakeAnki } from "./fake-anki.ts";
import { silentLogger } from "./helpers.ts";

const MINING = "German Mining";
const REFOLD = "Refold Alemán-mil";

let db: Database;
let anki: FakeAnki;

function setup(decks = [MINING, REFOLD]) {
  db = openDatabase(":memory:");
  applyMigrations(db);
  anki = new FakeAnki();
  let clock = 1_794_600_000_000;
  const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now: () => clock });
  scheduler.register(
    createAnkiConnector({
      db,
      client: createAnkiClient({ url: "http://127.0.0.1:8765", fetchImpl: anki.fetch }),
      decks,
      refoldDecks: [REFOLD],
    }),
  );
  return {
    sync: async () => {
      clock += 60_000;
      return scheduler.run(ANKI_SOURCE);
    },
  };
}

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

/** All the logged actions of `kind` (and keeps the log for the afterEach check). */
const calls = (kind: string, since = 0) => anki.actions.slice(since).filter((entry) => entry.action === kind);

describe("the Anki connector", () => {
  afterEach(() => {
    // Whatever a test did, the connector only read, and never made Anki create a deck
    const sent = new Set(anki.actions.map((entry) => entry.action));
    for (const action of sent) {
      expect(READ_ACTIONS).toContain(action);
    }
    expect(anki.createdDecks).toEqual([]);
    db.close();
  });

  it("loads notes, cards and reviews of the configured decks the first time", async () => {
    const { sync } = setup();
    const outcome = await sync();

    expect(outcome).toEqual({
      source: "anki",
      ok: true,
      summary: {
        notes: 5,
        notesUpdated: 5,
        notesRemoved: 0,
        cardsUpdated: 5,
        cardsRemoved: 0,
        // The card in "Other" and the deleted card are not read
        reviews: 7,
        reviewsNew: 7,
        unknownOrigin: 3,
      },
    });
    expect([count("raw_anki_notes"), count("raw_anki_cards"), count("raw_anki_reviews")]).toEqual([5, 5, 7]);

    expect(db.prepare("SELECT * FROM cards ORDER BY note_id").all()).toEqual([
      {
        note_id: 1660000000560,
        word: "haben",
        deck: REFOLD,
        model: "Alemán-mil",
        origin: "refold-1k",
        content_id: null,
        line_id: null,
        source_title: null,
        created_ts: 1660000000560,
      },
      expect.objectContaining({ note_id: 1660000000561, word: "sein", origin: "refold-1k" }),
      expect.objectContaining({
        note_id: 1787000000000,
        word: "Brücke",
        origin: "unknown",
        source_title: "Easy German 412 - Im Supermarkt",
      }),
      expect.objectContaining({ note_id: 1788000000000, word: "Fenster", source_title: "Beispiel Spiel" }),
      expect.objectContaining({
        note_id: 1789000000000,
        word: "aufgeben",
        source_title: "Let's Play Beispiel #002 [Deutsch] - Der Anfang",
      }),
    ]);

    // Every review knows its note
    expect(count("reviews")).toBe(7);
    expect(db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE note_id IS NULL").get()).toEqual({
      count: 0,
    });

    // The raw card keeps its scheduling, not the rendered HTML
    const payload = JSON.parse(
      (
        db.prepare("SELECT payload FROM raw_anki_cards WHERE card_id = 1787000000001").get() as {
          payload: string;
        }
      ).payload,
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ interval: 30, reps: 4 });
    expect(payload).not.toHaveProperty("question");

    expect(getConnectorState(db, ANKI_SOURCE)?.cursor).toEqual({
      reviews: { [MINING]: 1794378600000, [REFOLD]: 1794385800000 },
    });
  });

  it("does nothing new when run again, and only asks for what changed", async () => {
    const { sync } = setup();
    await sync();
    const before = anki.actions.length;

    const outcome = await sync();
    expect(outcome).toMatchObject({ ok: true, summary: { notesUpdated: 0, cardsUpdated: 0, reviewsNew: 0 } });
    expect([count("raw_anki_notes"), count("raw_anki_cards"), count("raw_anki_reviews")]).toEqual([5, 5, 7]);
    expect([count("cards"), count("reviews")]).toEqual([5, 7]);

    expect(calls("notesInfo", before)).toEqual([]);
    expect(calls("cardsInfo", before)).toEqual([]);
    expect(calls("cardReviews", before).map((entry) => entry.params)).toEqual([
      { deck: MINING, startID: 1794378600000 },
      { deck: REFOLD, startID: 1794385800000 },
    ]);
  });

  it("picks up new reviews and edited notes", async () => {
    const { sync } = setup();
    await sync();
    anki.addReview([1794700000000, 1787000000001, 52, 4, 60, 30, 2600, 4000, 1]);
    anki.editField(1789000000000, "Expression", "etwas aufgeben", 1794700001);
    const before = anki.actions.length;

    const outcome = await sync();
    expect(outcome).toMatchObject({
      summary: { notesUpdated: 1, cardsUpdated: 1, reviewsNew: 1, reviews: 8 },
    });
    expect(calls("notesInfo", before).map((entry) => entry.params)).toEqual([{ notes: [1789000000000] }]);
    expect(db.prepare("SELECT word FROM cards WHERE note_id = 1789000000000").get()).toEqual({
      word: "etwas aufgeben",
    });
    expect(parseCursor(getConnectorState(db, ANKI_SOURCE)!.cursor).reviews[MINING]).toBe(1794700000000);
  });

  it("marks deleted notes as removed but keeps their reviews", async () => {
    const { sync } = setup();
    await sync();
    anki.deleteNote(1787000000000);

    expect(await sync()).toMatchObject({
      summary: { notesRemoved: 1, cardsRemoved: 1, notes: 4, reviews: 7 },
    });
    expect(count("raw_anki_notes")).toBe(5);
    expect(db.prepare("SELECT removed_at FROM raw_anki_notes WHERE note_id = 1787000000000").get()).toEqual({
      removed_at: expect.any(Number),
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE note_id = 1787000000000").get()).toEqual({
      count: 0,
    });
  });

  it("never asks for the reviews of a deck that does not exist, and keeps its cards", async () => {
    const { sync } = setup();
    await sync();
    anki.renameDeck(MINING, "Mining (renamed)");
    const before = anki.actions.length;

    const outcome = await sync();
    expect(outcome).toMatchObject({
      ok: true,
      summary: { notesRemoved: 0, cardsRemoved: 0, warnings: [`Deck not found in Anki: "${MINING}"`] },
    });
    expect(calls("cardReviews", before).map((entry) => entry.params?.deck)).toEqual([REFOLD]);
    // Its notes were not taken for deleted, and its cursor is kept
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM raw_anki_notes WHERE removed_at IS NOT NULL").get(),
    ).toEqual({
      count: 0,
    });
    expect(parseCursor(getConnectorState(db, ANKI_SOURCE)!.cursor).reviews[MINING]).toBe(1794378600000);
  });

  it("reads the old reviews of a card moved in from another deck", async () => {
    const { sync } = setup();
    await sync();
    anki.moveCard(1786500000001, MINING, 1794700002);
    const before = anki.actions.length;

    const outcome = await sync();
    expect(outcome).toMatchObject({ summary: { notesUpdated: 1, cardsUpdated: 1, reviewsNew: 1 } });
    expect(calls("cardReviews", before).find((entry) => entry.params?.deck === MINING)?.params?.startID).toBe(
      0,
    );
    expect(db.prepare("SELECT note_id FROM reviews WHERE review_id = 1794386000000").get()).toEqual({
      note_id: 1786500000000,
    });
  });

  it("records that Anki is closed without touching the data", async () => {
    const { sync } = setup();
    anki.closed = true;
    const first = await sync();
    expect(first).toMatchObject({ ok: false, error: expect.stringMatching(/Anki is not open/) });
    expect(count("raw_anki_notes")).toBe(0);
    expect(getConnectorState(db, ANKI_SOURCE)).toMatchObject({ lastOkAt: null, cursor: null });

    anki.closed = false;
    await sync();
    const cursor = getConnectorState(db, ANKI_SOURCE)!.cursor;
    anki.closed = true;
    expect(await sync()).toMatchObject({ ok: false });
    expect([count("cards"), count("reviews")]).toEqual([5, 7]);
    expect(getConnectorState(db, ANKI_SOURCE)).toMatchObject({
      cursor,
      lastError: expect.stringMatching(/not open/),
    });
  });

  it("counts the same reviews per day as Anki, except other decks and deleted cards", async () => {
    const { sync } = setup();
    await sync();
    const mosaik = reviewsPerDay(db, "America/Buenos_Aires", 4);
    // 03:30 on the 11th still belongs to the 10th; the reschedule (type 5) is not a review
    expect(Object.fromEntries(mosaik)).toEqual({ "2026-11-10": 5, "2026-11-11": 1 });

    const ankiDays = (await (
      await anki.fetch("", {
        method: "POST",
        body: JSON.stringify({ action: "getNumCardsReviewedByDay", version: 6 }),
      })
    ).json()) as { result: [string, number][] };
    // Anki also counts the card in "Other" and the deleted card
    expect(compareReviewsPerDay(mosaik, ankiDays.result)).toEqual([
      { day: "2026-11-11", mosaik: 1, anki: 3 },
    ]);
  });
});

describe("attributeOrigin", () => {
  it("gives premade decks and their subdecks the refold-1k origin, and the rest unknown", () => {
    const options = { refoldDecks: [REFOLD] };
    expect(attributeOrigin({ deck: REFOLD }, options).origin).toBe("refold-1k");
    expect(attributeOrigin({ deck: `${REFOLD}::Teil 1` }, options).origin).toBe("refold-1k");
    expect(attributeOrigin({ deck: `${REFOLD} 2` }, options).origin).toBe("unknown");
    expect(attributeOrigin({ deck: MINING }, options).origin).toBe("unknown");
  });
});

describe("parseCursor", () => {
  it("keeps only valid review ids", () => {
    expect(parseCursor(null)).toEqual({ reviews: {} });
    expect(parseCursor({ reviews: { a: 5, b: -1, c: "7", d: 1.5 } })).toEqual({ reviews: { a: 5 } });
    expect(parseCursor([1, 2])).toEqual({ reviews: {} });
  });
});
