/**
 * What agents talk to in server mode. An agent, on each computer, asks for its state (its cursor and
 * what the server already has of that computer), reads its sources with it, and sends the batch; the
 * server applies it as that computer (device) and keeps the new cursor.
 */
import type { AgentState, AnkiKnownJson, ConnectorBatch, GsmKnownJson } from "@mosaik/shared";
import type { Config } from "../config.ts";
import { type AnkiKnown, applyAnki, knownAnki } from "../connectors/anki/connector.ts";
import { type GsmKnown, applyGsm, knownGsm } from "../connectors/gsm/connector.ts";
import { getConnectorState, markRunStarted, markRunSucceeded } from "../connectors/state.ts";
import type { ConnectorResult } from "../connectors/types.ts";
import type { Database } from "../db/database.ts";

export const AGENT_BODY_LIMIT = 64 * 1024 * 1024;

export const gsmKnownToJson = (known: GsmKnown): GsmKnownJson => ({
  lines: [...known.lines].map(([id, line]) => [
    id,
    line.version,
    line.removed,
    line.gameId,
    line.timestamp,
    line.mine,
  ]),
  coverEtags: [...known.coverEtags],
});

export const gsmKnownFromJson = (json: GsmKnownJson): GsmKnown => ({
  lines: new Map(
    json.lines.map(([id, version, removed, gameId, timestamp, mine]) => [
      id,
      { version, removed, gameId, timestamp, mine },
    ]),
  ),
  coverEtags: new Map(json.coverEtags),
});

export const ankiKnownToJson = (known: AnkiKnown): AnkiKnownJson => ({
  notes: [...known.notes].map(([id, row]) => [id, row.mod, row.deck, row.removed]),
  cards: [...known.cards].map(([id, row]) => [id, row.mod, row.deck, row.removed]),
});

export const ankiKnownFromJson = (json: AnkiKnownJson): AnkiKnown => ({
  notes: new Map(json.notes.map(([id, mod, deck, removed]) => [id, { mod, deck, removed }])),
  cards: new Map(json.cards.map(([id, mod, deck, removed]) => [id, { mod, deck, removed }])),
});

export function agentState(db: Database, device: string, source: "gsm" | "anki"): AgentState {
  const cursor = getConnectorState(db, source, device)?.cursor ?? null;
  return source === "gsm"
    ? { source, device, cursor, known: gsmKnownToJson(knownGsm(db, device)) }
    : // Anki is the same collection everywhere: every device knows all of it
      { source, device, cursor, known: ankiKnownToJson(knownAnki(db)) };
}

/** Applies a batch as `device`, with that device's cursor, and records the run in its state. */
export function applyAgentBatch(
  db: Database,
  config: Config,
  device: string,
  batch: ConnectorBatch,
  now: number,
): ConnectorResult {
  markRunStarted(db, batch.source, now, device);
  const cursor = getConnectorState(db, batch.source, device)?.cursor ?? null;
  const result =
    batch.source === "gsm"
      ? applyGsm(db, batch, {
          device,
          cursor,
          attribution: { refoldDecks: config.ankiRefoldDecks, timeZone: config.timeZone },
          now,
        })
      : applyAnki(db, batch, { cursor, refoldDecks: config.ankiRefoldDecks, timeZone: config.timeZone, now });
  markRunSucceeded(db, batch.source, now, result, device);
  return result;
}
