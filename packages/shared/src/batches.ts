/**
 * Batches: what a connector read from its source in one run, before anything is written to a database.
 *
 * Each connector is split in two: `read` talks to the source (Anki, gsm.db) and returns a batch with
 * only what is new or changed, and `apply` writes a batch into Mosaik's database. In local mode the hub
 * runs both; with a server, an agent on each computer reads and sends the batch, and the server applies
 * it. A batch is plain JSON, so it can travel; these schemas check it on arrival.
 *
 * Applying the same batch twice writes nothing new: every row is keyed by the source's own id.
 */
import { z } from "zod";

/** The computer a batch was read on. The hub's own computer is `principal`. */
export const DEFAULT_DEVICE = "principal";
export const deviceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u, "letters, numbers, spaces, dots, dashes or underscores");

// Anki, as AnkiConnect returns it

export const noteInfoSchema = z.looseObject({
  noteId: z.number().int(),
  modelName: z.string(),
  tags: z.array(z.string()),
  fields: z.record(z.string(), z.object({ value: z.string(), order: z.number() })),
  mod: z.number().int(),
  cards: z.array(z.number().int()),
});

export const cardInfoSchema = z.looseObject({
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

/** `[id, cid, usn, ease, ivl, lastIvl, factor, time, type]`: one row of Anki's review log. */
export const reviewRowSchema = z.tuple([
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

export type NoteInfo = z.infer<typeof noteInfoSchema>;
export type CardInfo = z.infer<typeof cardInfoSchema>;
export type ReviewRow = z.infer<typeof reviewRowSchema>;

export const ankiBatchSchema = z.object({
  source: z.literal("anki"),
  version: z.literal(1),
  /** The configured decks that exist in Anki; notes and cards are only marked removed within them. */
  presentDecks: z.array(z.string()),
  warnings: z.array(z.string()),
  /** New or changed notes, with the configured deck each one belongs to. */
  notes: z.array(z.object({ deck: z.string(), note: noteInfoSchema })),
  cards: z.array(cardInfoSchema),
  removedNotes: z.array(z.number().int()),
  removedCards: z.array(z.number().int()),
  /** Reviews after each deck's cursor (or all of them, when a deck is read again). */
  reviews: z.array(z.object({ deck: z.string(), rows: z.array(reviewRowSchema) })),
});
export type AnkiBatch = z.infer<typeof ankiBatchSchema>;

// GameSentenceMiner, as gsm.db stores it

/** One row of `game_lines`. GSM may add columns; they travel along. */
export const gsmLineSchema = z.looseObject({
  id: z.string().min(1).max(200),
  game_id: z.string().nullable(),
  game_name: z.string().nullable(),
  line_text: z.string().nullable(),
  language: z.string().nullable(),
  note_ids: z.string().nullable(),
  timestamp: z.number(),
  last_modified: z.union([z.string(), z.number()]).nullable(),
});

/** One row of `games`, without its cover image. */
export const gsmGameSchema = z.looseObject({
  id: z.string().min(1).max(200),
});

export const gsmSettingsSchema = z.object({
  sessionGapSeconds: z.number().positive(),
  regexOutRepetitions: z.boolean(),
  extraPunctuationRegex: z.string(),
});

export const gsmBatchSchema = z.object({
  source: z.literal("gsm"),
  version: z.literal(1),
  settings: gsmSettingsSchema,
  /** New or changed lines. */
  lines: z.array(gsmLineSchema),
  /** Ids of lines deleted from GSM (lines of days GSM archived are not counted as deleted). */
  removed: z.array(z.string()),
  /** Every game, whole: they are few. */
  games: z.array(gsmGameSchema),
  /** Every break the user marked, epoch seconds. */
  breaks: z.array(z.number()),
  /** Games that have a cover in GSM; a stored GSM cover of any other game of this computer goes. */
  coverGames: z.array(z.string()),
  /** Covers that are new or changed, as GSM stores them, with their hash. */
  covers: z.array(z.object({ gameId: z.string(), image: z.string(), etag: z.string() })),
});
export type GsmBatch = z.infer<typeof gsmBatchSchema>;
export type GsmSettings = z.infer<typeof gsmSettingsSchema>;

export const connectorBatchSchema = z.discriminatedUnion("source", [ankiBatchSchema, gsmBatchSchema]);
export type ConnectorBatch = z.infer<typeof connectorBatchSchema>;
