/** Reads and writes `connector_state`. */
import type { Database } from "../db/database.ts";
import type { JsonValue } from "./types.ts";

export interface ConnectorState {
  source: string;
  cursor: JsonValue | null;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  lastSummary: Record<string, JsonValue> | null;
}

interface Row {
  source: string;
  cursor: string | null;
  last_run_at: number | null;
  last_ok_at: number | null;
  last_error: string | null;
  last_summary: string | null;
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fromRow(row: Row): ConnectorState {
  return {
    source: row.source,
    cursor: parseJson<JsonValue>(row.cursor),
    lastRunAt: row.last_run_at,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    lastSummary: parseJson<Record<string, JsonValue>>(row.last_summary),
  };
}

export function getConnectorState(db: Database, source: string): ConnectorState | null {
  const row = db.prepare("SELECT * FROM connector_state WHERE source = ?").get(source) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listConnectorStates(db: Database): ConnectorState[] {
  const rows = db.prepare("SELECT * FROM connector_state ORDER BY source").all() as unknown as Row[];
  return rows.map(fromRow);
}

export function markRunStarted(db: Database, source: string, at: number): void {
  db.prepare(
    `INSERT INTO connector_state (source, last_run_at) VALUES (?, ?)
     ON CONFLICT (source) DO UPDATE SET last_run_at = excluded.last_run_at`,
  ).run(source, at);
}

export function markRunSucceeded(
  db: Database,
  source: string,
  at: number,
  result: { cursor?: JsonValue | null | undefined; summary?: Record<string, JsonValue> | undefined },
): void {
  const keepCursor = result.cursor === undefined;
  db.prepare(
    `INSERT INTO connector_state (source, cursor, last_ok_at, last_error, last_summary)
     VALUES (:source, :cursor, :at, NULL, :summary)
     ON CONFLICT (source) DO UPDATE SET
       cursor = CASE WHEN :keepCursor THEN connector_state.cursor ELSE excluded.cursor END,
       last_ok_at = excluded.last_ok_at,
       last_error = NULL,
       last_summary = excluded.last_summary`,
  ).run({
    source,
    cursor: keepCursor ? null : JSON.stringify(result.cursor),
    at,
    summary: result.summary === undefined ? null : JSON.stringify(result.summary),
    keepCursor: keepCursor ? 1 : 0,
  });
}

export function markRunFailed(db: Database, source: string, error: string): void {
  db.prepare(
    `INSERT INTO connector_state (source, last_error) VALUES (?, ?)
     ON CONFLICT (source) DO UPDATE SET last_error = excluded.last_error`,
  ).run(source, error);
}
