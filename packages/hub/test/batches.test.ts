import { ankiBatchSchema, connectorBatchSchema, gsmBatchSchema } from "@mosaik/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createAnkiClient } from "../src/connectors/anki/client.ts";
import { applyAnki, createAnkiConnector, knownAnki, readAnki } from "../src/connectors/anki/connector.ts";
import { applyGsm, createGsmConnector, knownGsm, readGsm } from "../src/connectors/gsm/connector.ts";
import type { ConnectorResult } from "../src/connectors/types.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { FakeAnki } from "./fake-anki.ts";
import { FakeGsm, type LineInput } from "./fake-gsm.ts";
import { silentLogger, tempDir } from "./helpers.ts";

const NOW = 1_794_600_000_000;
const TZ = "America/Buenos_Aires";
const MINING = "German Mining";
const REFOLD = "Refold Alemán-mil";
/** 2026-11-10 13:00 in Buenos Aires. */
const T = 1_794_326_400;

const opened: Database[] = [];
function freshDb(): Database {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

/** JSON text with its keys sorted: a validated batch keeps every field, but in the schema's order. */
const sortedJson = (text: string): string =>
  JSON.stringify(JSON.parse(text), (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value,
  );

/** A table's rows, sorted, without the columns that only say when something was written. */
function dump(db: Database, table: string): unknown[] {
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  return rows
    .map((row) => {
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "synced_at" || key === "fetched_at") continue;
        copy[key] =
          value instanceof Uint8Array
            ? Buffer.from(value).toString("hex")
            : key === "payload" && typeof value === "string"
              ? sortedJson(value)
              : value;
      }
      return JSON.stringify(copy);
    })
    .sort();
}

/** What a batch looks like after travelling: JSON text, checked by its schema on arrival. */
const travel = <T>(batch: T): unknown => connectorBatchSchema.parse(JSON.parse(JSON.stringify(batch)));

const run = (connector: { run: (context: never) => Promise<ConnectorResult> }) =>
  connector.run({ cursor: null, now: () => NOW, log: silentLogger } as never);

const line = (id: string, offset: number, extra: Partial<LineInput> = {}): LineInput => ({
  id,
  gameId: "game-a",
  gameName: "Beispiel Spiel",
  text: "Ein kurzer Satz.",
  timestamp: T + offset,
  ...extra,
});

function fakeGsm(gameId: string, title: string, lines: LineInput[], breaks: number[] = []): FakeGsm {
  const gsm = new FakeGsm(tempDir());
  gsm.addGame(gameId, title);
  gsm.addLines(lines);
  for (const timestamp of breaks) gsm.addBreak(timestamp);
  return gsm;
}

const where = (gsm: FakeGsm) => ({ dbPath: gsm.dbPath, dataDir: gsm.dataDir });
const attribution = { refoldDecks: [REFOLD] };

const GSM_TABLES = [
  "raw_gsm_lines",
  "raw_gsm_games",
  "raw_gsm_breaks",
  "contents",
  "sessions",
  "lines",
  "covers",
  "cards",
];

describe("GSM batches", () => {
  const gsmLines = [
    ...["a1", "a2", "a3", "a4", "a5", "a6"].map((id, index) => line(id, index * 10)),
    line("a7", 3650),
    line("n1", 100, { gameId: "", gameName: "Browser - YouTube" }),
  ];

  it("applied after travelling as JSON, give the same database as the direct run", async () => {
    const gsm = fakeGsm("game-a", "Beispiel Spiel", gsmLines, [T + 25]);
    const direct = freshDb();
    await run(createGsmConnector({ db: direct, locate: () => where(gsm), attribution, timeZone: TZ }));

    const viaBatch = freshDb();
    const batch = readGsm(where(gsm), knownGsm(viaBatch), TZ);
    expect(gsmBatchSchema.safeParse(batch).success).toBe(true);
    const result = applyGsm(viaBatch, gsmBatchSchema.parse(travel(batch)), {
      cursor: null,
      attribution,
      now: NOW,
    });

    for (const table of GSM_TABLES) expect(dump(viaBatch, table), table).toEqual(dump(direct, table));
    expect(result.summary).toMatchObject({ linesUpdated: gsmLines.length, rebuilt: true });
  });

  it("a second read finds nothing new, and applying a batch twice changes nothing", () => {
    const gsm = fakeGsm("game-a", "Beispiel Spiel", gsmLines);
    const db = freshDb();
    const batch = readGsm(where(gsm), knownGsm(db), TZ);
    const first = applyGsm(db, batch, { cursor: null, attribution, now: NOW });
    const before = GSM_TABLES.map((table) => dump(db, table));

    applyGsm(db, batch, { cursor: first.cursor ?? null, attribution, now: NOW + 1 });
    expect(GSM_TABLES.map((table) => dump(db, table))).toEqual(before);

    const again = readGsm(where(gsm), knownGsm(db), TZ);
    expect(again.lines).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.covers).toEqual([]);
    const third = applyGsm(db, again, { cursor: first.cursor ?? null, attribution, now: NOW + 2 });
    expect(third.summary).toMatchObject({ linesUpdated: 0, rebuilt: false });
  });

  it("keeps each computer's lines, games, breaks and sessions apart", () => {
    // The same game on two computers, read at overlapping times, plus a game only the notebook has
    const principal = fakeGsm("game-a", "Beispiel Spiel", [line("p1", 0), line("p2", 10)], [T + 5]);
    const notebook = fakeGsm("game-b", "Anderes Spiel", [
      line("b1", 5, { gameId: "game-b", gameName: "Anderes Spiel" }),
      line("b2", 15, { gameId: "game-b", gameName: "Anderes Spiel" }),
    ]);
    const db = freshDb();
    const options = (device: string) => ({ device, cursor: null, attribution, now: NOW });

    applyGsm(db, readGsm(where(principal), knownGsm(db, "principal"), TZ), options("principal"));
    applyGsm(db, readGsm(where(notebook), knownGsm(db, "notebook"), TZ), options("notebook"));
    // The principal computer reads again: the notebook's lines are not "deleted from GSM"
    principal.addLines([line("p3", 20)]);
    const next = readGsm(where(principal), knownGsm(db, "principal"), TZ);
    expect(next.removed).toEqual([]);
    expect(next.lines.map((row) => row.id)).toEqual(["p3"]);
    applyGsm(db, next, options("principal"));

    const byDevice = (sql: string) =>
      Object.fromEntries(
        (db.prepare(sql).all() as { device: string; n: number }[]).map((row) => [row.device, row.n]),
      );
    expect(
      byDevice("SELECT device, COUNT(*) AS n FROM raw_gsm_lines WHERE removed_at IS NULL GROUP BY device"),
    ).toEqual({ principal: 3, notebook: 2 });
    expect(byDevice("SELECT device, COUNT(*) AS n FROM raw_gsm_games GROUP BY device")).toEqual({
      principal: 1,
      notebook: 1,
    });
    expect(byDevice("SELECT device, COUNT(*) AS n FROM raw_gsm_breaks GROUP BY device")).toEqual({
      principal: 1,
    });
    expect(
      byDevice("SELECT device, COUNT(*) AS n FROM sessions WHERE source = 'gsm' GROUP BY device"),
    ).toEqual({ principal: 1, notebook: 1 });
  });
});

describe("Anki batches", () => {
  const ANKI_TABLES = ["raw_anki_notes", "raw_anki_cards", "raw_anki_reviews", "cards", "reviews"];
  const decks = [MINING, REFOLD];

  it("applied after travelling as JSON, give the same database and cursor as the direct run", async () => {
    const direct = freshDb();
    const directAnki = new FakeAnki();
    const directResult = await run(
      createAnkiConnector({
        db: direct,
        client: createAnkiClient({ url: "http://127.0.0.1:8765", fetchImpl: directAnki.fetch }),
        decks,
        refoldDecks: [REFOLD],
      }),
    );

    const viaBatch = freshDb();
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: "http://127.0.0.1:8765", fetchImpl: anki.fetch });
    const batch = await readAnki({ client, decks, known: knownAnki(viaBatch), cursor: null });
    expect(ankiBatchSchema.safeParse(batch).success).toBe(true);
    const result = applyAnki(viaBatch, ankiBatchSchema.parse(travel(batch)), {
      cursor: null,
      refoldDecks: [REFOLD],
      now: NOW,
    });

    for (const table of ANKI_TABLES) expect(dump(viaBatch, table), table).toEqual(dump(direct, table));
    expect(result.cursor).toEqual(directResult.cursor);
    expect(result.summary).toEqual(directResult.summary);
  });

  it("a second read only brings what changed", async () => {
    const db = freshDb();
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: "http://127.0.0.1:8765", fetchImpl: anki.fetch });
    const first = applyAnki(db, await readAnki({ client, decks, known: knownAnki(db), cursor: null }), {
      cursor: null,
      refoldDecks: [REFOLD],
      now: NOW,
    });

    const again = await readAnki({ client, decks, known: knownAnki(db), cursor: first.cursor ?? null });
    expect(again.notes).toEqual([]);
    expect(again.cards).toEqual([]);
    expect(again.reviews.flatMap((entry) => entry.rows)).toEqual([]);

    const before = ANKI_TABLES.map((table) => dump(db, table));
    applyAnki(db, again, { cursor: first.cursor ?? null, refoldDecks: [REFOLD], now: NOW + 1 });
    expect(ANKI_TABLES.map((table) => dump(db, table))).toEqual(before);
  });
});
