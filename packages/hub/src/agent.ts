/**
 * Agent mode: runs on each computer where immersion happens, reads its Anki and GSM, and sends what is new
 * to the Mosaik server. It keeps no database: before reading, it asks the server for its state (its cursor
 * and what the server already has), so it only reads and sends what changed.
 *
 * Every run:
 * 1. sends the batches left in the outbox by an earlier run that could not reach the server;
 * 2. for each source, asks for its state, reads the source and sends the batch.
 *
 * When the server cannot be reached, the run stops (the sources keep their data, so the next run reads
 * it); a batch read but not delivered waits in the outbox. A source that cannot be read (Anki closed) is
 * reported to the server, so the dashboard shows it for this computer. A rejected token stops the agent.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentBatchResponse, type ConnectorBatch, agentStateSchema } from "@mosaik/shared";
import { ankiKnownFromJson, gsmKnownFromJson } from "./api/agent.ts";
import type { AnkiClient } from "./connectors/anki/client.ts";
import { readAnki } from "./connectors/anki/connector.ts";
import { readGsm } from "./connectors/gsm/connector.ts";
import type { GsmLocation } from "./connectors/gsm/source.ts";
import type { Logger } from "./connectors/types.ts";

export type AgentSource = "anki" | "gsm";

export interface AgentOptions {
  serverUrl: string;
  token: string;
  /** Where batches wait while the server cannot be reached. */
  outboxDir: string;
  anki?: { client: AnkiClient; decks: readonly string[] };
  gsm?: { locate: () => GsmLocation; timeZone: string };
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export interface AgentRun {
  /** Everything was read and delivered (or there was nothing to read). */
  ok: boolean;
  /** Why the agent stopped for good (a rejected token). */
  fatal: string | null;
  /** The server could not be reached. */
  offline: boolean;
  sent: { source: AgentSource; summary: Record<string, unknown> | null }[];
  /** Sources that could not be read, or batches the server refused. */
  errors: { source: AgentSource; error: string }[];
  /** Batches left in the outbox for later, and batches from the outbox delivered now. */
  queued: number;
  flushed: number;
}

class Offline extends Error {
  override name = "Offline";
}

class Refused extends Error {
  override name = "Refused";
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createAgent(options: AgentOptions) {
  const { serverUrl, token, outboxDir, log } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const now = options.now ?? Date.now;
  let fatal: string | null = null;
  let sequence = 0;

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, serverUrl), {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Offline(`server unreachable: ${describe(error)}`);
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status >= 500) throw new Offline(`server error ${response.status}`);
    if (!response.ok) {
      const code = typeof body.error === "string" ? body.error : null;
      const detail = typeof body.message === "string" ? `: ${body.message}` : "";
      throw new Refused(response.status, code, `${response.status} ${code ?? "error"}${detail}`);
    }
    return body;
  }

  const post = (path: string, body: unknown) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // Outbox: one JSON file per batch, named so that they sort in the order they were read

  const pending = () => {
    try {
      return readdirSync(outboxDir)
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch {
      return [];
    }
  };

  function enqueue(batch: ConnectorBatch) {
    mkdirSync(outboxDir, { recursive: true });
    const name = `${String(now()).padStart(15, "0")}-${String(sequence++).padStart(4, "0")}-${batch.source}.json`;
    writeFileSync(join(outboxDir, name), JSON.stringify(batch));
  }

  /** Sends what waits in the outbox, in order. False when it had to stop (the server cannot be reached). */
  async function flush(run: AgentRun): Promise<boolean> {
    for (const name of pending()) {
      const file = join(outboxDir, name);
      try {
        await post("/api/agent/batches", JSON.parse(readFileSync(file, "utf8")));
        unlinkSync(file);
        run.flushed += 1;
      } catch (error) {
        if (error instanceof Refused && error.status === 401) throw error;
        if (error instanceof Refused) {
          // The server will never take it: set aside, so it does not block the rest
          mkdirSync(join(outboxDir, "rejected"), { recursive: true });
          renameSync(file, join(outboxDir, "rejected", name));
          log.error({ batch: name, error: error.message }, "the server refused a waiting batch");
          continue;
        }
        return false;
      }
    }
    return true;
  }

  async function read(source: AgentSource): Promise<ConnectorBatch> {
    const state = agentStateSchema.parse(await call(`/api/agent/state?source=${source}`));
    if (state.source === "gsm") {
      const gsm = options.gsm!;
      return readGsm(gsm.locate(), gsmKnownFromJson(state.known), gsm.timeZone);
    }
    const anki = options.anki!;
    return readAnki({
      client: anki.client,
      decks: anki.decks,
      known: ankiKnownFromJson(state.known),
      cursor: state.cursor,
    });
  }

  async function runOnce(): Promise<AgentRun> {
    const run: AgentRun = { ok: false, fatal, offline: false, sent: [], errors: [], queued: 0, flushed: 0 };
    if (fatal) return run;
    try {
      if (!(await flush(run))) {
        run.offline = true;
        run.queued = pending().length;
        return run;
      }
      const sources = [...(options.anki ? ["anki" as const] : []), ...(options.gsm ? ["gsm" as const] : [])];
      for (const source of sources) {
        let batch: ConnectorBatch;
        try {
          batch = await read(source);
        } catch (error) {
          if (error instanceof Offline || (error instanceof Refused && error.status === 401)) throw error;
          // The source could not be read on this computer: the dashboard shows why
          const message = describe(error);
          run.errors.push({ source, error: message });
          log.warn({ source, error: message }, "could not read the source");
          await post("/api/agent/report", { source, error: message }).catch(() => undefined);
          continue;
        }
        try {
          const answer = (await post("/api/agent/batches", batch)) as AgentBatchResponse;
          run.sent.push({ source, summary: answer.summary });
        } catch (error) {
          if (error instanceof Offline) {
            enqueue(batch);
            throw error;
          }
          if (error instanceof Refused && error.status !== 401) {
            run.errors.push({ source, error: error.message });
            log.error({ source, error: error.message }, "the server refused the batch");
            continue;
          }
          throw error;
        }
      }
      run.ok = run.errors.length === 0;
    } catch (error) {
      if (error instanceof Refused && error.status === 401) {
        fatal = `the server rejected this computer's token (${error.code ?? "401"}): create a new one in Fuentes → Dispositivos`;
        run.fatal = fatal;
        log.error({}, fatal);
      } else if (error instanceof Offline) {
        run.offline = true;
        log.warn({ error: error.message }, "the server cannot be reached; trying again next time");
      } else {
        run.errors.push({ source: "gsm", error: describe(error) });
        log.error({ error: describe(error) }, "agent run failed");
      }
    }
    run.queued = pending().length;
    return run;
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<AgentRun> | null = null;

  /** Runs now and then every `intervalMs`, never two runs at once. Stops by itself after a fatal error. */
  function start(intervalMs: number, onRun?: (run: AgentRun) => void) {
    const tick = () => {
      if (running) return;
      running = runOnce()
        .then((run) => {
          onRun?.(run);
          if (run.fatal) stop();
          return run;
        })
        .finally(() => {
          running = null;
        });
    };
    tick();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { runOnce, start, stop, idle: () => running ?? Promise.resolve(null) };
}
