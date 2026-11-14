/**
 * Numbered SQL migrations (`migrations/0001_name.sql`), applied in order when the hub starts.
 *
 * Each one runs once, in its own transaction, and is recorded in `schema_migrations` with a checksum
 * of its text. Applying them again does nothing. A migration that was already applied must never be
 * edited (add a new one instead): if its text changed, or the database has a migration this code does
 * not know (it was opened by a newer version), the hub refuses to start rather than guess.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Database, transaction } from "./database.ts";

/** The `migrations/` folder of the hub package, both from `src/` and from `dist/`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

/** Line endings do not change a migration: a checkout on Windows must match one on Linux. */
function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".sql")) {
      continue;
    }
    const match = FILE_NAME.exec(file);
    if (!match) {
      throw new MigrationError(`Migration file name must look like 0001_name.sql: ${file}`);
    }
    const sql = readFileSync(join(dir, file), "utf8");
    migrations.push({ version: Number(match[1]), name: match[2]!, sql, checksum: checksumOf(sql) });
  }
  migrations.sort((a, b) => a.version - b.version);
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index]!.version === migrations[index - 1]!.version) {
      throw new MigrationError(`Two migrations share version ${migrations[index]!.version}`);
    }
  }
  return migrations;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

/**
 * Applies the migrations that are missing.
 * @returns the versions applied now (empty when the database was already up to date)
 */
export function applyMigrations(db: Database, migrations: Migration[] = readMigrations()): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`);

  const applied = new Map<number, AppliedRow>();
  for (const row of db.prepare("SELECT version, name, checksum FROM schema_migrations").all()) {
    const typed = row as unknown as AppliedRow;
    applied.set(typed.version, typed);
  }

  const known = new Set(migrations.map((migration) => migration.version));
  const unknown = [...applied.keys()].filter((version) => !known.has(version));
  if (unknown.length > 0) {
    throw new MigrationError(
      `The database has migrations this version of Mosaik does not know (${unknown.join(", ")}); ` +
        "it was probably opened by a newer version.",
    );
  }

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
  );
  const newlyApplied: number[] = [];
  for (const migration of migrations) {
    const previous = applied.get(migration.version);
    if (previous) {
      if (previous.checksum !== migration.checksum) {
        throw new MigrationError(
          `Migration ${migration.version}_${migration.name} changed after it was applied. ` +
            "Applied migrations must not be edited: add a new one.",
        );
      }
      continue;
    }
    transaction(db, () => {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, migration.checksum, Date.now());
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}

/** The newest migration applied, 0 for an empty database. */
export function schemaVersion(db: Database): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
    { version: number | null } | undefined;
  return row?.version ?? 0;
}
