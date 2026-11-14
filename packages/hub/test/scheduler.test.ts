import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectorState } from "../src/connectors/state.ts";
import type { Connector, ConnectorContext } from "../src/connectors/types.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { silentLogger } from "./helpers.ts";

let db: Database;
let clock: number;
const now = () => clock;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db);
  clock = 1_000;
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

/** A connector that counts its runs and returns the run number as its cursor. */
function counter(source: string): Connector & { contexts: ConnectorContext[] } {
  const contexts: ConnectorContext[] = [];
  return {
    source,
    contexts,
    async run(context) {
      contexts.push(context);
      return { cursor: { runs: contexts.length }, summary: { runs: contexts.length } };
    },
  };
}

describe("createScheduler", () => {
  it("records a successful run and hands its cursor to the next one", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    const connector = counter("anki");
    scheduler.register(connector);

    expect(await scheduler.run("anki")).toEqual({ source: "anki", ok: true, summary: { runs: 1 } });
    clock = 2_000;
    await scheduler.run("anki");

    expect(connector.contexts.map((context) => context.cursor)).toEqual([null, { runs: 1 }]);
    expect(getConnectorState(db, "anki")).toEqual({
      source: "anki",
      cursor: { runs: 2 },
      lastRunAt: 2_000,
      lastOkAt: 2_000,
      lastError: null,
      lastSummary: { runs: 2 },
    });
  });

  it("keeps the previous cursor when a run returns none", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    let first = true;
    scheduler.register({
      source: "gsm",
      async run() {
        const result = first ? { cursor: { last: 42 } } : {};
        first = false;
        return result;
      },
    });
    await scheduler.run("gsm");
    await scheduler.run("gsm");
    expect(getConnectorState(db, "gsm")?.cursor).toEqual({ last: 42 });
  });

  it("records a failure without losing the last good run, and the next success clears it", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    let fail = false;
    scheduler.register({
      source: "anki",
      async run() {
        if (fail) {
          throw new Error("Anki is not running");
        }
        return { cursor: "c1" };
      },
    });

    await scheduler.run("anki");
    fail = true;
    clock = 5_000;
    expect(await scheduler.run("anki")).toEqual({ source: "anki", ok: false, error: "Anki is not running" });
    expect(getConnectorState(db, "anki")).toMatchObject({
      cursor: "c1",
      lastRunAt: 5_000,
      lastOkAt: 1_000,
      lastError: "Anki is not running",
    });

    fail = false;
    await scheduler.run("anki");
    expect(getConnectorState(db, "anki")?.lastError).toBeNull();
  });

  it("does not let one failing connector stop the others", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    const good = counter("gsm");
    scheduler.register({
      source: "anki",
      async run() {
        throw new Error("down");
      },
    });
    scheduler.register(good);

    const outcomes = await scheduler.runAll();
    expect(outcomes.map((outcome) => [outcome.source, outcome.ok])).toEqual([
      ["anki", false],
      ["gsm", true],
    ]);
    expect(good.contexts).toHaveLength(1);
  });

  it("never runs the same connector twice at once", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    let release!: () => void;
    let runs = 0;
    scheduler.register({
      source: "anki",
      run() {
        runs += 1;
        return new Promise((resolve) => {
          release = () => resolve({});
        });
      },
    });

    const first = scheduler.run("anki");
    const second = scheduler.run("anki");
    expect(scheduler.isRunning("anki")).toBe(true);
    release();
    expect(await first).toBe(await second);
    expect(runs).toBe(1);
    expect(scheduler.isRunning("anki")).toBe(false);
  });

  it("runs the connectors one after the other, in the order they were registered", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    const events: string[] = [];
    const slow = (source: string): Connector => ({
      source,
      async run() {
        events.push(`${source} start`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`${source} end`);
        return {};
      },
    });
    scheduler.register(slow("anki"));
    scheduler.register(slow("gsm"));
    await scheduler.runAll();
    expect(events).toEqual(["anki start", "anki end", "gsm start", "gsm end"]);
  });

  it("answers an unknown source without throwing", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    expect(await scheduler.run("nope")).toEqual({ source: "nope", ok: false, error: "unknown source" });
  });

  it("refuses two connectors for the same source", () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    scheduler.register(counter("anki"));
    expect(() => scheduler.register(counter("anki"))).toThrow(/already registered/);
  });

  it("runs every connector when it starts and then on every interval, until stopped", async () => {
    vi.useFakeTimers();
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    const connector = counter("anki");
    scheduler.register(connector);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(connector.contexts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(connector.contexts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connector.contexts).toHaveLength(4);

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(connector.contexts).toHaveLength(4);
  });

  it("starts with no connectors at all", async () => {
    const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger, now });
    scheduler.start();
    expect(await scheduler.runAll()).toEqual([]);
    await scheduler.stop();
  });
});
