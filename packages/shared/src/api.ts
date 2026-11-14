/** Responses of the hub's read API, used by the dashboard. */

export interface HealthResponse {
  status: "ok";
  /** Always "mosaik", so a client can tell the hub apart from another server on the same port. */
  name: "mosaik";
  version: string;
  /** The newest database migration applied. */
  schemaVersion: number;
  /** Server time, UTC milliseconds. */
  now: number;
}

export interface SourceStatus {
  source: string;
  /** Whether a connector for this source is registered in the running hub. */
  registered: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  /** What the last successful run did, as the connector reported it (counts, etc.). */
  lastSummary: Record<string, unknown> | null;
}

export interface SourcesResponse {
  sources: SourceStatus[];
}

export type SyncOutcome =
  | { source: string; ok: true; summary: Record<string, unknown> | null }
  | { source: string; ok: false; error: string };

export interface ApiError {
  error: string;
  message?: string;
}
