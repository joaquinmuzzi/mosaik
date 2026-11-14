/**
 * `POST /api/ingest/events`: events pushed by sources (Deuchan). The contract is in
 * packages/shared/src/ingest.ts and docs/ingest-api.md.
 *
 * Each event is validated on its own and stored as received in `raw_events`; an id the hub already
 * has is ignored. When something new arrived, the source's rows of the common model and the origin of
 * the cards are rebuilt. The source's state (`connector_state`) shows when it last sent something.
 */
import {
  type IngestRejection,
  type IngestResponse,
  ingestBatchSchema,
  parseIngestEvent,
} from "@mosaik/shared";
import { markRunStarted, markRunSucceeded } from "./connectors/state.ts";
import { type Database, transaction } from "./db/database.ts";
import { type AttributionOptions, rebuildCards } from "./derive/cards.ts";
import { DEUCHAN_SOURCE, rebuildDeuchan } from "./derive/deuchan.ts";

/** A day_total of the backfill may carry 200 videos, and a batch 500 events. */
export const INGEST_BODY_LIMIT = 16 * 1024 * 1024;

export interface IngestOptions {
  attribution: AttributionOptions;
  timeZone: string;
  now?: () => number;
}

export type IngestResult =
  { status: 200; body: IngestResponse } | { status: 400; body: { error: "invalid_batch"; message: string } };

export function ingestEvents(db: Database, body: unknown, options: IngestOptions): IngestResult {
  const batch = ingestBatchSchema.safeParse(body);
  if (!batch.success) {
    const message = batch.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
    return {
      status: 400,
      body: { error: "invalid_batch", message: `Expected { events: [1 to 500 events] }. ${message}` },
    };
  }

  const now = (options.now ?? Date.now)();
  const rejected: IngestRejection[] = [];
  let accepted = 0;
  let duplicates = 0;
  const sources = new Set<string>();

  transaction(db, () => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO raw_events (id, source, kind, received_at, payload) VALUES (?, ?, ?, ?, ?)",
    );
    batch.data.events.forEach((input, index) => {
      const parsed = parseIngestEvent(input);
      if (!parsed.ok) {
        rejected.push(
          parsed.id === undefined
            ? { index, error: parsed.error }
            : { index, id: parsed.id, error: parsed.error },
        );
        return;
      }
      const { event } = parsed;
      const result = insert.run(event.id, event.source, event.kind, now, JSON.stringify(event));
      if (Number(result.changes) > 0) {
        accepted += 1;
        sources.add(event.source);
      } else {
        duplicates += 1;
      }
    });

    let summary = null;
    if (sources.has(DEUCHAN_SOURCE)) {
      const derived = rebuildDeuchan(db, { timeZone: options.timeZone });
      rebuildCards(db, options.attribution);
      const events = db
        .prepare("SELECT COUNT(*) AS count FROM raw_events WHERE source = ?")
        .get(DEUCHAN_SOURCE) as { count: number };
      summary = {
        events: events.count,
        videos: derived.videos,
        sessions: derived.sessions,
        watchSeconds: Math.round(derived.seconds),
        days: derived.days,
      };
    }
    // Even a batch of duplicates means the source is alive
    markRunStarted(db, DEUCHAN_SOURCE, now);
    if (summary) {
      markRunSucceeded(db, DEUCHAN_SOURCE, now, { summary });
    } else {
      db.prepare("UPDATE connector_state SET last_ok_at = ?, last_error = NULL WHERE source = ?").run(
        now,
        DEUCHAN_SOURCE,
      );
    }
  });

  return { status: 200, body: { accepted, duplicates, rejected } };
}
