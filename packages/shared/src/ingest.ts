/**
 * The events that sources push to the hub (`POST /api/ingest/events`). This is the contract with
 * Deuchan and any future push source; docs/ingest-api.md describes it for people.
 *
 * Rules shared by every event:
 * - `id` is unique and chosen by the source. The hub ignores an id it already has, so a source can
 *   resend a batch whose answer it never got. An event with a given id never changes.
 * - Times are UTC epoch milliseconds (integers).
 * - Events are validated one by one: a bad event is rejected without losing the rest of the batch.
 */
import { z } from "zod";

/** 2100-01-01: anything later is a unit mistake (microseconds) or garbage. */
const MAX_EPOCH_MS = 4_102_444_800_000;

/** A day has at most 25 hours (the day clocks go back). */
const MAX_DAY_SECONDS = 25 * 3600;

/** Deuchan does not believe a single interval longer than this either (see its coverage.js). */
const MAX_INTERVAL_SECONDS = 6 * 3600;

export const MAX_EVENTS_PER_BATCH = 500;

const eventId = z.string().min(1).max(200);
const epochMs = z.number().int().min(0).max(MAX_EPOCH_MS);
/** A language tag such as "de" or "de-AT". */
const language = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const youtubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const title = z.string().max(500);
/**
 * An item that is not a YouTube video: a namespaced id chosen by the source, such as `web:<hash>` for
 * a video on another site or a page read by hand.
 */
const itemId = z.string().regex(/^[a-z]+:\S{1,190}$/);
const url = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//);
/** What the time was spent on. Reading is counted by hand (comics, for example). */
export const contentKindSchema = z.enum(["video", "reading"]);
export type ContentKind = z.infer<typeof contentKindSchema>;

/** Fields that name what was watched or read: a YouTube `videoId`, or an `itemId` for anything else. */
const itemFields = {
  videoId: youtubeVideoId.optional(),
  itemId: itemId.optional(),
  url: url.optional(),
  /** The site, for example "twitch.tv". */
  site: z.string().min(1).max(100).optional(),
  contentKind: contentKindSchema.optional(),
};
const hasItem = (item: { videoId?: string | undefined; itemId?: string | undefined }) =>
  item.videoId !== undefined || item.itemId !== undefined;
const itemMessage = { message: "videoId or itemId is required", path: ["videoId"] };

/** The id of the content an item is about: `yt:<videoId>` for YouTube, else its `itemId`. */
export function deuchanContentId(item: {
  videoId?: string | undefined;
  itemId?: string | undefined;
}): string {
  return item.videoId !== undefined ? `yt:${item.videoId}` : item.itemId!;
}

/**
 * Some seconds of a video that were watched, between `from` and `to`. `seconds` is the time credited,
 * which can be less than `to - from` when another tab was already playing part of that time.
 */
export const watchIntervalEventSchema = z
  .object({
    id: eventId,
    source: z.literal("deuchan"),
    kind: z.literal("watch_interval"),
    language,
    from: epochMs,
    to: epochMs,
    seconds: z.number().positive().max(MAX_INTERVAL_SECONDS),
    ...itemFields,
    title: title.optional(),
    channelId: z.string().min(1).max(100).optional(),
  })
  .refine(hasItem, itemMessage)
  .refine((event) => event.to > event.from, { message: "to must be after from", path: ["to"] })
  // One second of slack for rounding
  .refine((event) => event.seconds <= (event.to - event.from) / 1000 + 1, {
    message: "seconds cannot exceed the length of the interval",
    path: ["seconds"],
  });

/**
 * A snapshot of what the source shows for a whole day, corrections included. Sent as a backfill of
 * the history and again whenever a recent day changes. It holds only what was watched or read on the
 * device that sends it: for each device and day the hub keeps the snapshot with the newest `at`, and a
 * day is the sum of its devices. Give every snapshot its own `id` (for example
 * `deuchan:day:<day>:<at>`).
 * `day` is the source's own day, which may not start at the hub's cutoff hour.
 */
export const dayTotalEventSchema = z.object({
  id: eventId,
  source: z.literal("deuchan"),
  kind: z.literal("day_total"),
  language,
  day: dayString,
  /** When the snapshot was taken. */
  at: epochMs,
  seconds: z.number().min(0).max(MAX_DAY_SECONDS),
  /** The part of `seconds` counted by hand as reading. */
  readingSeconds: z.number().min(0).max(MAX_DAY_SECONDS).optional(),
  videos: z
    .array(
      z
        .object({ ...itemFields, title, seconds: z.number().min(0).max(MAX_DAY_SECONDS) })
        .refine(hasItem, itemMessage),
    )
    .max(200)
    .optional(),
});

/** The person said a video of a day was not in the language: its time of that day does not count. */
export const videoRemovedEventSchema = z
  .object({
    id: eventId,
    source: z.literal("deuchan"),
    kind: z.literal("video_removed"),
    // Deuchan sends it, like on every event; nothing depends on it here
    language: language.optional(),
    day: dayString,
    /** The local hour the source's days start at; midnight when it does not say. */
    dayStartHour: z.number().int().min(0).max(23).optional(),
    at: epochMs,
    videoId: youtubeVideoId.optional(),
    itemId: itemId.optional(),
  })
  .refine(hasItem, itemMessage);

export const ingestEventSchema = z.discriminatedUnion("kind", [
  watchIntervalEventSchema,
  dayTotalEventSchema,
  videoRemovedEventSchema,
]);

export type WatchIntervalEvent = z.infer<typeof watchIntervalEventSchema>;
export type DayTotalEvent = z.infer<typeof dayTotalEventSchema>;
export type VideoRemovedEvent = z.infer<typeof videoRemovedEventSchema>;
export type IngestEvent = z.infer<typeof ingestEventSchema>;

/** The body of `POST /api/ingest/events`. Events are only checked to be objects here; see above. */
export const ingestBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

export interface IngestRejection {
  /** Position of the event in the batch. */
  index: number;
  id?: string;
  error: string;
}

export interface IngestResponse {
  /** New events stored. */
  accepted: number;
  /** Events whose id the hub already had: nothing to do, and nothing to resend. */
  duplicates: number;
  /** Events that will never be accepted as they are. Resending them does not help. */
  rejected: IngestRejection[];
}

export type ParsedEvent = { ok: true; event: IngestEvent } | { ok: false; id?: string; error: string };

/** Validates one event of a batch. */
export function parseIngestEvent(input: unknown): ParsedEvent {
  const result = ingestEventSchema.safeParse(input);
  if (result.success) {
    return { ok: true, event: result.data };
  }
  const id =
    typeof input === "object" && input !== null && typeof (input as { id?: unknown }).id === "string"
      ? (input as { id: string }).id
      : undefined;
  const error = result.error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
  return id === undefined ? { ok: false, error } : { ok: false, id, error };
}
