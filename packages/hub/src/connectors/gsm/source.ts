/**
 * Finding and reading GameSentenceMiner's database (`gsm.db`) without ever writing to it.
 *
 * GSM keeps the database in WAL mode. Opening it "read-only" (`readOnly`, or `?mode=ro`) still makes
 * SQLite create the `-wal` and `-shm` files when they are missing, which is a change in GSM's folder.
 * So:
 * - when both files exist (GSM is running, or crashed), the database is opened read-only, which sees
 *   what GSM has not yet checkpointed and creates nothing;
 * - when they do not, everything is in the main file, which is opened as immutable: nothing is
 *   created, nothing is locked. If GSM starts in the meantime it writes to its new WAL, not to the
 *   main file, and what it writes is read on the next run.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { DEFAULT_SESSION_GAP_SECONDS } from "./reading-time.ts";

type Env = Record<string, string | undefined>;

export class GsmSourceError extends Error {
  override name = "GsmSourceError";
}

/** GSM's default data folder (`get_default_app_directory`). */
export function defaultGsmDataDir(env: Env, platform: NodeJS.Platform, home: string): string {
  return platform === "win32" && env.APPDATA
    ? join(env.APPDATA, "GameSentenceMiner")
    : join(home, ".config", "GameSentenceMiner");
}

function readPointer(file: string): string | null {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { dataDir?: unknown };
    return typeof data.dataDir === "string" && isAbsolute(data.dataDir) ? data.dataDir : null;
  } catch {
    return null;
  }
}

/**
 * GSM's data folder: the one named in `~/.config/GameSentenceMiner/data_dir.json` (or the older
 * pointer in the default folder) if the user moved it, else the default one.
 */
export function resolveGsmDataDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const fallback = defaultGsmDataDir(env, platform, home);
  return (
    readPointer(join(home, ".config", "GameSentenceMiner", "data_dir.json")) ??
    readPointer(join(fallback, "data_dir.json")) ??
    fallback
  );
}

export interface GsmLocation {
  dbPath: string;
  /** Where GSM's `config.json` is. */
  dataDir: string;
}

export function locateGsm(configured: string | null, env: Env = process.env): GsmLocation {
  if (configured) {
    return { dbPath: configured, dataDir: dirname(configured) };
  }
  const dataDir = resolveGsmDataDir(env);
  return { dbPath: join(dataDir, "gsm.db"), dataDir };
}

/** Opens `gsm.db` for reading only, creating no file next to it (see the top of this file). */
export function openGsmReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) {
    throw new GsmSourceError(`GameSentenceMiner's database was not found at ${path}`);
  }
  try {
    if (existsSync(`${path}-wal`) && existsSync(`${path}-shm`)) {
      return new DatabaseSync(path, { readOnly: true });
    }
    const url = pathToFileURL(path);
    url.searchParams.set("immutable", "1");
    return new DatabaseSync(url, { readOnly: true });
  } catch (error) {
    throw new GsmSourceError(
      `Could not open GameSentenceMiner's database at ${path}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** The settings of GSM's statistics that change how its reading time is computed. */
export interface GsmStatsSettings {
  sessionGapSeconds: number;
  regexOutRepetitions: boolean;
  extraPunctuationRegex: string;
}

export const DEFAULT_GSM_STATS: GsmStatsSettings = {
  sessionGapSeconds: DEFAULT_SESSION_GAP_SECONDS,
  regexOutRepetitions: false,
  extraPunctuationRegex: "",
};

/** Reads the `stats` section of GSM's `config.json`, so Mosaik counts with the user's settings. */
export function readGsmStatsSettings(dataDir: string): GsmStatsSettings {
  try {
    const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      stats?: Record<string, unknown>;
    };
    const stats = config.stats ?? {};
    const gap = stats.session_gap_seconds;
    return {
      sessionGapSeconds:
        typeof gap === "number" && Number.isFinite(gap) && gap > 0
          ? gap
          : DEFAULT_GSM_STATS.sessionGapSeconds,
      regexOutRepetitions: stats.regex_out_repetitions === true,
      extraPunctuationRegex:
        typeof stats.extra_punctuation_regex === "string" ? stats.extra_punctuation_regex : "",
    };
  } catch {
    return DEFAULT_GSM_STATS;
  }
}

/** One row of `game_lines`, as GSM stores it. */
export interface GsmLineRow {
  id: string;
  game_id: string | null;
  game_name: string | null;
  line_text: string | null;
  language: string | null;
  note_ids: string | null;
  timestamp: number;
  last_modified: string | null;
  [column: string]: unknown;
}

/** One row of `games`, without its cover image. */
export interface GsmGameRow {
  id: string;
  title_original: string | null;
  title_english: string | null;
  obs_scene_name: string | null;
  type: string | null;
  character_count: string | null;
  [column: string]: unknown;
}

export interface GsmSnapshot {
  /** Every line id with its modification time (epoch seconds). */
  lineVersions: Map<string, number>;
  /** Full rows of the lines asked for. */
  lines: GsmLineRow[];
  games: GsmGameRow[];
  /** Reading breaks, epoch seconds. */
  breaks: number[];
  /** `game_id|date` of the days GSM archived (their lines leave `game_lines` but still count). */
  archivedDays: Set<string>;
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

/** A line's version: its last_modified, or its timestamp when GSM did not record one. */
export function lineVersion(lastModified: unknown, timestamp: number): number {
  const parsed =
    typeof lastModified === "string" || typeof lastModified === "number" ? Number(lastModified) : NaN;
  return Number.isFinite(parsed) ? parsed : timestamp;
}

/**
 * Reads what the connector needs. `wanted` decides, from each line's id and version, which full rows
 * to fetch (the new and changed ones).
 */
export function readGsmSnapshot(
  db: DatabaseSync,
  wanted: (id: string, version: number) => boolean,
): GsmSnapshot {
  if (!hasTable(db, "game_lines")) {
    throw new GsmSourceError("GameSentenceMiner's database has no game_lines table");
  }
  const lineVersions = new Map<string, number>();
  const ids: string[] = [];
  const versions = db.prepare("SELECT id, last_modified, timestamp FROM game_lines").all() as {
    id: string;
    last_modified: unknown;
    timestamp: number;
  }[];
  for (const row of versions) {
    const version = lineVersion(row.last_modified, row.timestamp);
    lineVersions.set(row.id, version);
    if (wanted(row.id, version)) ids.push(row.id);
  }
  const lines =
    ids.length === 0
      ? []
      : (db
          .prepare("SELECT * FROM game_lines WHERE id IN (SELECT value FROM json_each(?))")
          .all(JSON.stringify(ids)) as unknown as GsmLineRow[]);

  const games = hasTable(db, "games")
    ? (db.prepare("SELECT * FROM games ORDER BY id").all() as unknown as GsmGameRow[]).map(
        ({ image: _image, ...game }) => game as GsmGameRow,
      )
    : [];
  const breaks = hasTable(db, "stats_reading_breaks")
    ? (db.prepare("SELECT timestamp FROM stats_reading_breaks").all() as { timestamp: unknown }[])
        .map((row) => Number(row.timestamp))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
    : [];
  const archivedDays = new Set(
    hasTable(db, "archived_game_days")
      ? (
          db.prepare("SELECT game_id, date FROM archived_game_days").all() as {
            game_id: string;
            date: string;
          }[]
        ).map((row) => `${row.game_id}|${row.date}`)
      : [],
  );
  return { lineVersions, lines, games, breaks, archivedDays };
}
