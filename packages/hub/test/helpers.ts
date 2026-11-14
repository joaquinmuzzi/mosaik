import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import type { Config } from "../src/config.ts";
import type { Logger } from "../src/connectors/types.ts";

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** A folder that is removed when the test ends. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mosaik-test-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: "127.0.0.1",
    port: 7300,
    dbPath: ":memory:",
    gsmDbPath: "/nonexistent/gsm.db",
    ankiConnectUrl: "http://127.0.0.1:8765",
    dayCutoffHour: 4,
    timeZone: "America/Buenos_Aires",
    syncIntervalMinutes: 5,
    logLevel: "silent",
    ...overrides,
  };
}
