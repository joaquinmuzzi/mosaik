/**
 * Starts the hub: configuration, database (with its migrations), scheduler and server.
 * `--pretty` prints readable logs instead of JSON lines (used by `npm run dev`).
 */
import type { FastifyServerOptions } from "fastify";
import { ConfigError, loadConfig } from "./config.ts";
import type { Logger } from "./connectors/types.ts";
import { openDatabase } from "./db/database.ts";
import { applyMigrations, schemaVersion } from "./db/migrate.ts";
import { createScheduler } from "./scheduler.ts";
import { buildServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const pretty = process.argv.includes("--pretty");
  const logger: FastifyServerOptions["logger"] = pretty
    ? {
        level: config.logLevel,
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : { level: config.logLevel };

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
  // Connectors are registered here, one per source, as they are written (Anki in phase 1, GSM in phase 2)

  const app = await buildServer({ config, db, scheduler, logger });
  schedulerLog = app.log;
  app.log.info(
    { dbPath: config.dbPath, schemaVersion: schemaVersion(db), migrationsApplied: applied },
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
