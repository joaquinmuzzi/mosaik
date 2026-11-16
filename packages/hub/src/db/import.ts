/**
 * Moving an existing Mosaik database to the server, once: the server receives the file (before the account
 * exists, with the setup token) and leaves it next to its database; at the next start, before the database
 * is opened, it takes its place. The database it replaces is kept beside it, renamed.
 */
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync } from "node:fs";

export const IMPORT_SUFFIX = ".import";
const SQLITE_HEADER = "SQLite format 3\0";

export const looksLikeSqlite = (data: Uint8Array) =>
  data.length >= 100 && Buffer.from(data.subarray(0, 16)).toString("latin1") === SQLITE_HEADER;

function fileLooksLikeSqlite(path: string): boolean {
  const header = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString("latin1") === SQLITE_HEADER;
}

/**
 * Puts a waiting import in place of the database, if there is one. Returns what happened, for the log:
 * null when there was nothing to import.
 */
export function promoteImport(
  dbPath: string,
  now = Date.now(),
): { replacedBy: string; keptAs: string | null } | null {
  const waiting = `${dbPath}${IMPORT_SUFFIX}`;
  if (!existsSync(waiting)) return null;
  if (!fileLooksLikeSqlite(waiting)) {
    rmSync(waiting);
    return null;
  }
  let keptAs: string | null = null;
  if (existsSync(dbPath)) {
    keptAs = `${dbPath}.before-import-${now}`;
    renameSync(dbPath, keptAs);
  }
  // The old database's journal must not be applied to the new one
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  renameSync(waiting, dbPath);
  return { replacedBy: waiting, keptAs };
}
