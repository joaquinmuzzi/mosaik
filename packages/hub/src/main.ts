/**
 * Starts the hub: configuration, database (with its migrations), scheduler and server. In agent mode
 * (MOSAIK_MODE=agent) it starts the agent instead, which has no database and no server.
 * `--pretty` prints readable logs instead of JSON lines (used by `npm run dev`).
 * `--log-file=<path>` writes the JSON logs to that file instead, for when the hub runs in the
 * background (started with Windows, see scripts/autostart.ps1).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FastifyServerOptions } from "fastify";
import { agentLogger, runAgent } from "./agent-main.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createConnectors } from "./connectors/index.ts";
import type { Logger } from "./connectors/types.ts";
import { openDatabase } from "./db/database.ts";
import { promoteImport } from "./db/import.ts";
import { applyMigrations, schemaVersion } from "./db/migrate.ts";
import { createScheduler } from "./scheduler.ts";
import { buildServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const pretty = process.argv.includes("--pretty");
  const logFile = process.argv.find((arg) => arg.startsWith("--log-file="))?.slice("--log-file=".length);
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  if (config.mode === "agent") {
    runAgent(config, agentLogger(config, pretty, logFile));
    return;
  }
  const logger: FastifyServerOptions["logger"] = pretty
    ? {
        level: config.logLevel,
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : logFile
      ? { level: config.logLevel, file: logFile }
      : { level: config.logLevel };

  // A database sent to the server to replace this one (POST /api/admin/import) takes its place now
  const imported = promoteImport(config.dbPath);
  if (imported)
    console.log(
      `Imported database in place of ${config.dbPath}; the old one is ${imported.keptAs ?? "none"}`,
    );
  const db = openDatabase(config.dbPath);
  const applied = applyMigrations(db);

  // The scheduler logs through the server's logger, so it is attached once the server exists
  let schedulerLog: Logger = console;
  const scheduler = createScheduler({
    db,
    intervalMs: config.syncIntervalMinutes * 60_000,
    log: {
      info: (object, message) => schedulerLog.info(object, message),
      warn: (object, message) => schedulerLog.warn(object, message),
      error: (object, message) => schedulerLog.error(object, message),
    },
  });
  // In server mode the sources are read on each computer, by its agent
  if (config.mode === "local") {
    for (const connector of createConnectors(db, config)) {
      scheduler.register(connector);
    }
  }

  const app = await buildServer({ config, db, scheduler, logger });
  schedulerLog = app.log;
  app.log.info(
    {
      mode: config.mode,
      dbPath: config.dbPath,
      schemaVersion: schemaVersion(db),
      migrationsApplied: applied,
    },
    "database ready",
  );

  let closing = false;
  const close = async (signal: string) => {
    if (closing) {
      return;
    }
    closing = true;
    app.log.info({ signal }, "shutting down");
    await scheduler.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("SIGTERM", () => void close("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  scheduler.start();
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
