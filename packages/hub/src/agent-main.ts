/**
 * Runs the agent (MOSAIK_MODE=agent): reads this computer's Anki and GSM every SYNC_INTERVAL_MINUTES and
 * sends them to the server. Logs one line per event, as JSON (to `--log-file` when given) or readable
 * with `--pretty`.
 */
import { appendFileSync } from "node:fs";
import { createAgent } from "./agent.ts";
import type { Config } from "./config.ts";
import { createAnkiClient } from "./connectors/anki/client.ts";
import { locateGsm } from "./connectors/gsm/source.ts";
import type { Logger } from "./connectors/types.ts";

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 } as const;

export function agentLogger(config: Config, pretty: boolean, logFile: string | undefined): Logger {
  const threshold = LEVELS[config.logLevel];
  const write = (level: "info" | "warn" | "error", object: object, message?: string) => {
    if (LEVELS[level] < threshold) return;
    const line = pretty
      ? `${new Date().toTimeString().slice(0, 8)} ${level.toUpperCase().padEnd(5)} ${message ?? ""} ${
          Object.keys(object).length > 0 ? JSON.stringify(object) : ""
        }`.trimEnd()
      : JSON.stringify({ level: LEVELS[level], time: Date.now(), msg: message, ...object });
    if (logFile) appendFileSync(logFile, `${line}\n`);
    else if (level === "info") console.log(line);
    else console.error(line);
  };
  return {
    info: (object, message) => write("info", object, message),
    warn: (object, message) => write("warn", object, message),
    error: (object, message) => write("error", object, message),
  };
}

export function runAgent(config: Config, log: Logger): void {
  const agent = createAgent({
    serverUrl: config.serverUrl!,
    token: config.deviceToken!,
    outboxDir: config.outboxDir,
    anki: { client: createAnkiClient({ url: config.ankiConnectUrl }), decks: config.ankiDecks },
    gsm: { locate: () => locateGsm(config.gsmDbPath), timeZone: config.timeZone },
    log,
  });
  log.info(
    { server: config.serverUrl, everyMinutes: config.syncIntervalMinutes, outbox: config.outboxDir },
    "agent started",
  );
  agent.start(config.syncIntervalMinutes * 60_000, (run) => {
    const sent = Object.fromEntries(run.sent.map(({ source, summary }) => [source, summary]));
    if (run.fatal) {
      // A rejected token does not fix itself: stop, so the problem shows
      log.error({}, "agent stopped");
      process.exit(1);
    }
    log.info(
      { ok: run.ok, offline: run.offline, queued: run.queued, flushed: run.flushed, sent },
      "agent run",
    );
  });

  const stop = (signal: string) => {
    log.info({ signal }, "agent stopping");
    agent.stop();
    void agent.idle().then(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}
