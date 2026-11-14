import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.ts";
import { MigrationError, applyMigrations, readMigrations, schemaVersion } from "../src/db/migrate.ts";
import { tempDir } from "./helpers.ts";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
}

describe("the hub's migrations", () => {
  it("create connector_state", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["connector_state", "schema_migrations"]));
    expect(schemaVersion(db)).toBe(readMigrations().at(-1)!.version);
  });

  it("are idempotent: applying them again, even after reopening the file, changes nothing", () => {
    const path = join(tempDir(), "mosaik.db");
    const first = openDatabase(path);
    const applied = applyMigrations(first);
    expect(applied.length).toBeGreaterThan(0);
    first.prepare("INSERT INTO connector_state (source, last_run_at) VALUES ('anki', 1)").run();
    expect(applyMigrations(first)).toEqual([]);
    first.close();

    const second = openDatabase(path);
    expect(applyMigrations(second)).toEqual([]);
    expect(second.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: applied.length,
    });
    // The data survived
    expect(second.prepare("SELECT source FROM connector_state").all()).toEqual([{ source: "anki" }]);
    second.close();
  });

  it("are numbered without gaps in the file names", () => {
    const versions = readMigrations().map((migration) => migration.version);
    expect(versions).toEqual(versions.map((_, index) => index + 1));
  });
});

describe("applyMigrations", () => {
  it("applies new migrations on top of the old ones, in order", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (x INTEGER);");
    const db = openDatabase(":memory:");
    expect(applyMigrations(db, readMigrations(dir))).toEqual([1]);

    writeFileSync(join(dir, "0003_third.sql"), "CREATE TABLE c (x INTEGER REFERENCES b(x));");
    writeFileSync(join(dir, "0002_second.sql"), "CREATE TABLE b (x INTEGER PRIMARY KEY);");
    expect(applyMigrations(db, readMigrations(dir))).toEqual([2, 3]);
    expect(schemaVersion(db)).toBe(3);
  });

  it("leaves nothing behind when a migration fails", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_broken.sql"), "CREATE TABLE ok (x INTEGER); THIS IS NOT SQL;");
    const db = openDatabase(":memory:");
    expect(() => applyMigrations(db, readMigrations(dir))).toThrow();
    expect(tableNames(db)).toEqual(["schema_migrations"]);
    expect(schemaVersion(db)).toBe(0);
  });

  it("refuses a migration that was edited after it was applied", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (x INTEGER);");
    const db = openDatabase(":memory:");
    applyMigrations(db, readMigrations(dir));
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (x INTEGER, y TEXT);");
    expect(() => applyMigrations(db, readMigrations(dir))).toThrow(MigrationError);
  });

  it("does not see a change in line endings as an edit", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (\n  x INTEGER\n);\n");
    const db = openDatabase(":memory:");
    applyMigrations(db, readMigrations(dir));
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (\r\n  x INTEGER\r\n);\r\n");
    expect(applyMigrations(db, readMigrations(dir))).toEqual([]);
  });

  it("refuses a database migrated by a newer version", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "0001_first.sql"), "CREATE TABLE a (x INTEGER);");
    writeFileSync(join(dir, "0002_second.sql"), "CREATE TABLE b (x INTEGER);");
    const db = openDatabase(":memory:");
    applyMigrations(db, readMigrations(dir));
    expect(() => applyMigrations(db, readMigrations(dir).slice(0, 1))).toThrow(/newer version/);
  });

  it("refuses badly named files and repeated versions", () => {
    const badName = tempDir();
    writeFileSync(join(badName, "1_first.sql"), "SELECT 1;");
    expect(() => readMigrations(badName)).toThrow(MigrationError);

    const repeated = tempDir();
    writeFileSync(join(repeated, "0001_a.sql"), "SELECT 1;");
    writeFileSync(join(repeated, "0001_b.sql"), "SELECT 1;");
    expect(() => readMigrations(repeated)).toThrow(/share version 1/);
  });
});

describe("node:sqlite", () => {
  it("includes FTS5, which the sentence search needs", () => {
    const db = openDatabase(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(text)");
    db.prepare("INSERT INTO t (text) VALUES (?)").run("Ich habe den Einwand erhoben");
    expect(db.prepare("SELECT text FROM t WHERE t MATCH 'einwand'").all()).toHaveLength(1);
  });
});
