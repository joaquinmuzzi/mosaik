/**
 * A typed client for AnkiConnect (http://127.0.0.1:8765), which only answers while Anki is open.
 *
 * Mosaik never writes to Anki: the client only knows read actions and refuses any other before it
 * reaches the network. Beware that, in the AnkiConnect the user runs, `cardReviews` and
 * `getLatestReviewID` create the deck they are given when it does not exist; the connector checks
 * that a deck exists before asking for its reviews.
 */
import { z } from "zod";

/** The only actions Mosaik sends. */
export const READ_ACTIONS = [
  "version",
  "deckNamesAndIds",
  "findNotes",
  "findCards",
  "notesInfo",
  "notesModTime",
  "cardsInfo",
  "cardsModTime",
  "cardReviews",
  "getNumCardsReviewedByDay",
] as const;

export type ReadAction = (typeof READ_ACTIONS)[number];

const READ_ACTION_SET: ReadonlySet<string> = new Set(READ_ACTIONS);

/** Card properties kept from `cardsInfo`; the rest (rendered question, answer, CSS) is not data. */
export const CARD_FIELDS = [
  "cardId",
  "note",
  "deckName",
  "modelName",
  "ord",
  "type",
  "queue",
  "due",
  "interval",
  "factor",
  "reps",
  "lapses",
  "left",
  "mod",
  "flags",
] as const;

export type AnkiErrorKind = "unreachable" | "timeout" | "http" | "api" | "invalid_response" | "forbidden";

export class AnkiConnectError extends Error {
  override name = "AnkiConnectError";
  readonly kind: AnkiErrorKind;

  constructor(kind: AnkiErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
  }
}

const envelopeSchema = z.object({ result: z.unknown(), error: z.string().nullable() });

const noteInfoSchema = z.looseObject({
  noteId: z.number().int(),
  modelName: z.string(),
  tags: z.array(z.string()),
  fields: z.record(z.string(), z.object({ value: z.string(), order: z.number() })),
  mod: z.number().int(),
  cards: z.array(z.number().int()),
});

const cardInfoSchema = z.looseObject({
  cardId: z.number().int(),
  note: z.number().int(),
  deckName: z.string(),
  modelName: z.string(),
  ord: z.number().int(),
  type: z.number().int(),
  queue: z.number().int(),
  due: z.number().int(),
  interval: z.number().int(),
  factor: z.number().int(),
  reps: z.number().int(),
  lapses: z.number().int(),
  mod: z.number().int(),
});

const modTimeSchema = (key: "noteId" | "cardId") =>
  z.union([z.object({ [key]: z.number().int(), mod: z.number().int() }), z.strictObject({})]);

/** `[id, cid, usn, ease, ivl, lastIvl, factor, time, type]`: one row of Anki's review log. */
const reviewRowSchema = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);

/** Missing ids come back as `{}`. */
const orMissing = <T extends z.ZodType>(schema: T) => z.union([schema, z.strictObject({})]);

export type NoteInfo = z.infer<typeof noteInfoSchema>;
export type CardInfo = z.infer<typeof cardInfoSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;
export type Missing = Record<string, never>;

export interface AnkiClient {
  version(): Promise<number>;
  deckNamesAndIds(): Promise<Record<string, number>>;
  findNotes(query: string): Promise<number[]>;
  findCards(query: string): Promise<number[]>;
  notesInfo(ids: number[]): Promise<(NoteInfo | Missing)[]>;
  notesModTime(ids: number[]): Promise<({ noteId: number; mod: number } | Missing)[]>;
  cardsInfo(ids: number[]): Promise<(CardInfo | Missing)[]>;
  cardsModTime(ids: number[]): Promise<({ cardId: number; mod: number } | Missing)[]>;
  /** Reviews of the cards of `deck` with an id greater than `startId` (0 for all). */
  cardReviews(deck: string, startId: number): Promise<ReviewRow[]>;
  /** `[day, count]` for the whole collection, newest first, as Anki's statistics count them. */
  getNumCardsReviewedByDay(): Promise<[string, number][]>;
}

export interface AnkiClientOptions {
  url: string;
  timeoutMs?: number;
  /** Ids sent per request in the `*Info` and `*ModTime` actions. */
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, action: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
    throw new AnkiConnectError(
      "invalid_response",
      `AnkiConnect answered ${action} with something unexpected${where}: ${issue?.message ?? "invalid"}`,
    );
  }
  return result.data;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Throws unless `action` is one of the read actions. Every request goes through it. */
export function assertReadAction(action: string): asserts action is ReadAction {
  if (!READ_ACTION_SET.has(action)) {
    throw new AnkiConnectError("forbidden", `Mosaik does not send "${action}" to Anki: it only reads`);
  }
}

export function createAnkiClient({
  url,
  timeoutMs = 30_000,
  batchSize = 500,
  fetchImpl = globalThis.fetch,
}: AnkiClientOptions): AnkiClient {
  async function invoke(action: ReadAction, params?: Record<string, unknown>): Promise<unknown> {
    // The type already forbids other actions; this also stops a cast or a typo at runtime
    assertReadAction(action);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params === undefined ? { action, version: 6 } : { action, version: 6, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AnkiConnectError("timeout", `AnkiConnect did not answer ${action} within ${timeoutMs} ms`, {
          cause: error,
        });
      }
      throw new AnkiConnectError("unreachable", `Anki is not open (AnkiConnect is not reachable at ${url})`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new AnkiConnectError("http", `AnkiConnect answered ${action} with HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new AnkiConnectError("invalid_response", `AnkiConnect answered ${action} with invalid JSON`, {
        cause: error,
      });
    }
    const envelope = parse(envelopeSchema, body, action);
    if (envelope.error !== null) {
      throw new AnkiConnectError("api", `AnkiConnect ${action}: ${envelope.error}`);
    }
    return envelope.result;
  }

  async function batched<T extends z.ZodType>(
    action: ReadAction,
    key: "notes" | "cards",
    ids: number[],
    schema: T,
    extra: Record<string, unknown> = {},
  ): Promise<z.infer<T>[]> {
    const results: z.infer<T>[] = [];
    for (const batch of chunks(ids, batchSize)) {
      const result = parse(z.array(schema), await invoke(action, { [key]: batch, ...extra }), action);
      if (result.length !== batch.length) {
        throw new AnkiConnectError(
          "invalid_response",
          `AnkiConnect answered ${action} with ${result.length} items for ${batch.length} ids`,
        );
      }
      results.push(...result);
    }
    return results;
  }

  return {
    version: async () => parse(z.number().int(), await invoke("version"), "version"),
    deckNamesAndIds: async () =>
      parse(z.record(z.string(), z.number()), await invoke("deckNamesAndIds"), "deckNamesAndIds"),
    findNotes: async (query) =>
      parse(z.array(z.number().int()), await invoke("findNotes", { query }), "findNotes"),
    findCards: async (query) =>
      parse(z.array(z.number().int()), await invoke("findCards", { query }), "findCards"),
    notesInfo: (ids) =>
      batched("notesInfo", "notes", ids, orMissing(noteInfoSchema)) as Promise<(NoteInfo | Missing)[]>,
    notesModTime: (ids) =>
      batched("notesModTime", "notes", ids, modTimeSchema("noteId")) as Promise<
        ({ noteId: number; mod: number } | Missing)[]
      >,
    cardsInfo: (ids) =>
      batched("cardsInfo", "cards", ids, orMissing(cardInfoSchema), { fields: CARD_FIELDS }) as Promise<
        (CardInfo | Missing)[]
      >,
    cardsModTime: (ids) =>
      batched("cardsModTime", "cards", ids, modTimeSchema("cardId")) as Promise<
        ({ cardId: number; mod: number } | Missing)[]
      >,
    cardReviews: async (deck, startId) =>
      parse(z.array(reviewRowSchema), await invoke("cardReviews", { deck, startID: startId }), "cardReviews"),
    getNumCardsReviewedByDay: async () =>
      parse(
        z.array(z.tuple([z.string(), z.number().int()])),
        await invoke("getNumCardsReviewedByDay"),
        "getNumCardsReviewedByDay",
      ),
  };
}

/** Whether `value` is one of the `{}` that AnkiConnect returns for an id it does not have. */
export function isMissing(value: object): value is Missing {
  return Object.keys(value).length === 0;
}

/**
 * The search for the cards of a deck, subdecks included. In Anki's search syntax `*` and `_` are
 * wildcards and `"` ends the term, so they are escaped.
 */
export function deckQuery(deck: string): string {
  return `deck:"${deck.replace(/[\\"*_]/g, (char) => `\\${char}`)}"`;
}
