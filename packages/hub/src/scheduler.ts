/**
 * Runs the registered pull connectors: once when the hub starts, every few minutes after that, and
 * when someone asks (`POST /api/sync/:source`).
 *
 * A connector that fails (Anki closed, GSM not installed) only records its error; the others keep
 * running and it is tried again on the next round. A connector never runs twice at the same time:
 * asking for a run while one is in progress waits for that one.
 */
import type { SyncOutcome } from "@mosaik/shared";
import { getConnectorState, markRunFailed, markRunStarted, markRunSucceeded } from "./connectors/state.ts";
import type { Connector, Logger } from "./connectors/types.ts";
import type { Database } from "./db/database.ts";

export interface SchedulerOptions {
  db: Database;
  intervalMs: number;
  log: Logger;
  now?: () => number;
}

export interface Scheduler {
  register(connector: Connector): void;
  sources(): string[];
  has(source: string): boolean;
  isRunning(source: string): boolean;
  /** Runs one connector now, or waits for the run already in progress. Never rejects. */
  run(source: string): Promise<SyncOutcome>;
  /** Runs every connector, one after the other in the order they were registered. Never rejects. */
  runAll(): Promise<SyncOutcome[]>;
  /** Starts the rounds: one right away, then one every `intervalMs`. */
  start(): void;
  /** Stops the rounds and waits for the runs in progress. */
  stop(): Promise<void>;
}

/** Keeps errors short and readable in the dashboard. */
function describe(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text.slice(0, 500);
}

export function createScheduler({ db, intervalMs, log, now = Date.now }: SchedulerOptions): Scheduler {
  const connectors = new Map<string, Connector>();
  const inFlight = new Map<string, Promise<SyncOutcome>>();
  let timer: NodeJS.Timeout | null = null;

  async function execute(connector: Connector): Promise<SyncOutcome> {
    const { source } = connector;
    const startedAt = now();
    try {
      markRunStarted(db, source, startedAt);
      const cursor = getConnectorState(db, source)?.cursor ?? null;
      const result = await connector.run({ cursor, now, log });
      markRunSucceeded(db, source, now(), result);
      log.info({ source, ms: now() - startedAt, summary: result.summary }, "connector run finished");
      return { source, ok: true, summary: result.summary ?? null };
    } catch (error) {
      const message = describe(error);
      try {
        markRunFailed(db, source, message);
      } catch (stateError) {
        log.error({ source, error: describe(stateError) }, "could not record connector failure");
      }
      log.warn({ source, error: message }, "connector run failed");
      return { source, ok: false, error: message };
    }
  }

  function run(source: string): Promise<SyncOutcome> {
    const connector = connectors.get(source);
    if (!connector) {
      return Promise.resolve({ source, ok: false, error: "unknown source" });
    }
    const running = inFlight.get(source);
    if (running) {
      return running;
    }
    const promise = execute(connector).finally(() => inFlight.delete(source));
    inFlight.set(source, promise);
    return promise;
  }

  // One after the other, in the order they were registered: a later source then sees what an earlier
  // one just wrote (GSM attributes the notes Anki has just copied)
  async function runAll(): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = [];
    for (const source of connectors.keys()) {
      outcomes.push(await run(source));
    }
    return outcomes;
  }

  return {
    register(connector) {
      if (connectors.has(connector.source)) {
        throw new Error(`A connector for "${connector.source}" is already registered`);
      }
      connectors.set(connector.source, connector);
    },
    sources: () => [...connectors.keys()],
    has: (source) => connectors.has(source),
    isRunning: (source) => inFlight.has(source),
    run,
    runAll,
    start() {
      if (timer) {
        return;
      }
      void runAll();
      timer = setInterval(() => void runAll(), intervalMs);
    },
    async stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await Promise.all(inFlight.values());
    },
  };
}
