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
    mode: "local",
    host: "127.0.0.1",
    port: 7300,
    publicUrl: null,
    setupToken: null,
    serverUrl: null,
    deviceToken: null,
    outboxDir: ":memory:",
    dbPath: ":memory:",
    gsmDbPath: null,
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiDecks: ["German Mining", "Refold Alemán-mil"],
    ankiRefoldDecks: ["Refold Alemán-mil"],
    dayCutoffHour: 4,
    timeZone: "America/Buenos_Aires",
    syncIntervalMinutes: 5,
    logLevel: "silent",
    targetLanguage: "de",
    youtubeThumbnails: false,
    ...overrides,
  };
}
