/**
 * A pull connector: something the hub runs to fetch new data from a source (Anki, GSM).
 *
 * A connector gets what it needs (database, configuration, clients) when it is created, and the
 * scheduler only calls `run`. Each run receives the cursor the previous successful run returned and
 * must be idempotent: running it twice over the same data writes nothing new (upserts by the source's
 * own ids). The scheduler stores the returned cursor after the run, so if the hub stops between the
 * two, the next run simply repeats some upserts.
 */

export interface Logger {
  info(object: object, message?: string): void;
  warn(object: object, message?: string): void;
  error(object: object, message?: string): void;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ConnectorContext {
  /** The cursor saved by the last successful run, `null` the first time. */
  cursor: JsonValue | null;
  now: () => number;
  log: Logger;
}

export interface ConnectorResult {
  /** Saved for the next run. Leaving it out keeps the previous one. */
  cursor?: JsonValue | null;
  /** What the run did (counts and the like), shown in the dashboard. */
  summary?: Record<string, JsonValue>;
}

export interface Connector {
  /** Short and stable: it is the key in `connector_state` and in `/api/sync/:source`. */
  readonly source: string;
  run(context: ConnectorContext): Promise<ConnectorResult>;
}
