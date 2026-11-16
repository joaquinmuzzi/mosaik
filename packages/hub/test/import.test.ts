import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { backupDatabase } from "../src/api/export.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { promoteImport } from "../src/db/import.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const SITE = "https://mosaik.test";
const SETUP_TOKEN = "setup-token-0123456789";

let app: FastifyInstance | undefined;
let db: Database | undefined;

afterEach(async () => {
  await app?.close();
  db?.close();
  app = undefined;
  db = undefined;
});

/** A small Mosaik database with one card, as the file a backup gives. */
function sampleDatabase(): Buffer {
  const source = openDatabase(":memory:");
  applyMigrations(source);
  source
    .prepare(
      "INSERT INTO cards (note_id, word, deck, model, origin, created_ts) VALUES (7, 'Glück', 'Mining', 'Kiku', 'gsm', 1)",
    )
    .run();
  const data = backupDatabase(source);
  source.close();
  return data;
}

describe("importing an existing database", () => {
  async function server(dbPath: string) {
    db = openDatabase(dbPath);
    applyMigrations(db);
    app = await buildServer({
      config: testConfig({
        mode: "server",
        host: "0.0.0.0",
        publicUrl: SITE,
        setupToken: SETUP_TOKEN,
        dbPath,
      }),
      db,
      scheduler: createScheduler({ db, intervalMs: 60_000, log: silentLogger }),
      webDistDir: join(tempDir(), "missing"),
    });
    return app;
  }

  const send = (server: FastifyInstance, body: Buffer, token = SETUP_TOKEN) =>
    server.inject({
      method: "POST",
      url: "/api/admin/import",
      headers: {
        host: "mosaik.test",
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      payload: body,
    });

  it("takes the file with the setup token, before the account exists, and leaves it next to the database", async () => {
    const dbPath = join(tempDir(), "mosaik.db");
    const target = await server(dbPath);
    const file = sampleDatabase();

    expect((await send(target, file, "not-the-setup-token")).statusCode).toBe(401);
    expect((await send(target, Buffer.from("hello, not a database"))).statusCode).toBe(400);
    const accepted = await send(target, file);
    expect(accepted.statusCode).toBe(202);
    expect(readFileSync(`${dbPath}.import`).equals(file)).toBe(true);

    await target.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: { host: "mosaik.test", origin: SITE },
      payload: { token: SETUP_TOKEN, username: "joaquin", password: "correct horse battery" },
    });
    expect((await send(target, file)).statusCode).toBe(409);
  });

  it("is not there in local mode", async () => {
    db = openDatabase(":memory:");
    applyMigrations(db);
    app = await buildServer({
      config: testConfig(),
      db,
      scheduler: createScheduler({ db, intervalMs: 60_000, log: silentLogger }),
      webDistDir: join(tempDir(), "missing"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/import",
      headers: { host: "127.0.0.1:7300", "content-type": "application/octet-stream" },
      payload: sampleDatabase(),
    });
    expect(response.statusCode).toBe(404);
  });

  it("puts the waiting file in place of the database at the next start, keeping the old one", () => {
    const dir = tempDir();
    const dbPath = join(dir, "mosaik.db");
    const old = openDatabase(dbPath);
    applyMigrations(old);
    old.close();
    writeFileSync(`${dbPath}-wal`, "stale journal");
    writeFileSync(`${dbPath}.import`, sampleDatabase());

    const result = promoteImport(dbPath, 1234);
    expect(result).toEqual({ replacedBy: `${dbPath}.import`, keptAs: `${dbPath}.before-import-1234` });
    expect(existsSync(`${dbPath}.import`)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}.before-import-1234`)).toBe(true);

    const imported = openDatabase(dbPath);
    const card = imported.prepare("SELECT word FROM cards WHERE note_id = 7").get();
    imported.close();
    expect(card).toEqual({ word: "Glück" });
    expect(promoteImport(dbPath)).toBeNull();
  });

  it("drops a waiting file that is not a database", () => {
    const dbPath = join(tempDir(), "mosaik.db");
    writeFileSync(`${dbPath}.import`, "x".repeat(200));
    expect(promoteImport(dbPath)).toBeNull();
    expect(existsSync(`${dbPath}.import`)).toBe(false);
  });
});
