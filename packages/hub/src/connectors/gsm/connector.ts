/**
 * The GameSentenceMiner connector, in two halves:
 *
 * - `readGsm` opens `gsm.db` read-only and returns a batch with what is new or changed since what the
 *   database already knows (`knownGsm`): lines, deleted lines, games, breaks, covers and GSM's settings.
 * - `applyGsm` writes a batch into the raw tables and, when something changed, rebuilds the GSM sessions,
 *   lines and contents, and the origin of the cards.
 *
 * In local mode the hub runs both, one after the other. With a server, an agent reads on its own computer
 * and the server applies. GSM edits lines after creating them (it fills `note_ids` when a card is mined),
 * so lines are compared by their `last_modified`, not by time: every read lists all line ids with their
 * versions (cheap) and fetches the new and changed rows only. A line that leaves `game_lines` was
 * deleted, unless GSM archived its day, in which case GSM still counts it and so does Mosaik.
 *
 * GSM is different on each computer, so everything here belongs to one device.
 */
import { createHash } from "node:crypto";
import { DEFAULT_DEVICE, type GsmBatch, type GsmSettings, dayKey } from "@mosaik/shared";
import type { Database } from "../../db/database.ts";
import { transaction } from "../../db/database.ts";
import { type AttributionOptions, rebuildCards } from "../../derive/cards.ts";
import { GSM_SOURCE, gsmContentId, rebuildGsm } from "../../derive/gsm.ts";
import type { Connector, ConnectorResult, JsonValue } from "../types.ts";
import { punctuationRegex } from "./reading-time.ts";
import {
  DEFAULT_GSM_STATS,
  type GsmLocation,
  decodeCover,
  lineVersion,
  openGsmReadOnly,
  readGsmStatsSettings,
  readGsmSnapshot,
} from "./source.ts";

export interface GsmConnectorOptions {
  db: Database;
  /** Where gsm.db and GSM's config.json are; resolved on every run, as GSM may be installed later. */
  locate: () => GsmLocation;
  attribution: AttributionOptions;
  /** The time zone GSM uses for its days (the computer's), to know which day a line was archived in. */
  timeZone: string;
}

/**
 * What the database already has, so a read of one computer's GSM only fetches what changed. Lines of
 * every computer are listed (a line another computer already sent is not sent again); `mine` marks this
 * computer's, the only ones it can find deleted.
 */
export interface GsmKnown {
  lines: Map<
    string,
    { version: number; removed: boolean; gameId: string | null; timestamp: number; mine: boolean }
  >;
  /** Game id → hash of its stored GSM cover. */
  coverEtags: Map<string, string>;
}

export function knownGsm(db: Database, device: string = DEFAULT_DEVICE): GsmKnown {
  const lines: GsmKnown["lines"] = new Map();
  for (const row of db
    .prepare(
      `SELECT id, last_modified, removed_at IS NOT NULL AS removed, game_id, timestamp, device = ? AS mine
       FROM raw_gsm_lines`,
    )
    .all(device) as {
    id: string;
    last_modified: number;
    removed: number;
    game_id: string | null;
    timestamp: number;
    mine: number;
  }[]) {
    lines.set(row.id, {
      version: row.last_modified,
      removed: row.removed === 1,
      gameId: row.game_id,
      timestamp: row.timestamp,
      mine: row.mine === 1,
    });
  }
  const coverEtags = new Map<string, string>();
  for (const row of db
    .prepare(
      `SELECT g.id, c.etag FROM raw_gsm_games g JOIN covers c ON c.content_id = 'gsm:' || g.id
       WHERE g.device = ? AND c.origin = 'gsm'`,
    )
    .all(device) as { id: string; etag: string }[]) {
    coverEtags.set(row.id, row.etag);
  }
  return { lines, coverEtags };
}

/** Reads gsm.db and returns what is new or changed compared with `known`. Writes nothing. */
export function readGsm(location: GsmLocation, known: GsmKnown, timeZone: string): GsmBatch {
  const settings = readGsmStatsSettings(location.dataDir);
  const gsm = openGsmReadOnly(location.dbPath);
  let snapshot;
  try {
    snapshot = readGsmSnapshot(gsm, (id, version) => {
      const line = known.lines.get(id);
      return !line || line.version !== version || line.removed;
    });
  } finally {
    gsm.close();
  }

  // This computer's lines gone from GSM: deleted, unless their day was archived (GSM days start at local
  // midnight)
  const removed: string[] = [];
  for (const [id, line] of known.lines) {
    if (!line.mine || line.removed || snapshot.lineVersions.has(id)) continue;
    const day = dayKey(line.timestamp * 1000, timeZone, 0);
    if (!snapshot.archivedDays.has(`${line.gameId ?? ""}|${day}`)) removed.push(id);
  }

  // Covers travel only when they are new or changed: they are the heavy part
  const covers: GsmBatch["covers"] = [];
  for (const [gameId, image] of snapshot.covers) {
    const etag = createHash("sha1").update(image).digest("hex");
    if (known.coverEtags.get(gameId) !== etag) covers.push({ gameId, image, etag });
  }

  return {
    source: "gsm",
    version: 1,
    settings: { ...settings },
    lines: snapshot.lines,
    removed,
    games: snapshot.games,
    breaks: snapshot.breaks,
    coverGames: [...snapshot.covers.keys()],
    covers,
  };
}

const sameSettings = (a: GsmSettings | null, b: GsmSettings) =>
  a !== null &&
  a.sessionGapSeconds === b.sessionGapSeconds &&
  a.regexOutRepetitions === b.regexOutRepetitions &&
  a.extraPunctuationRegex === b.extraPunctuationRegex;

/** The GSM settings saved in a cursor, or null. */
export function cursorSettings(cursor: JsonValue | null): GsmSettings | null {
  if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
    const settings = cursor.settings;
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      return settings as unknown as GsmSettings;
    }
  }
  return null;
}

export interface ApplyGsmOptions {
  device?: string;
  /** The cursor saved after the last batch of this device. */
  cursor: JsonValue | null;
  attribution: AttributionOptions;
  now: number;
}

/** Writes a batch into the database. Applying the same batch twice writes nothing new. */
export function applyGsm(
  db: Database,
  batch: GsmBatch,
  { device = DEFAULT_DEVICE, cursor, attribution, now }: ApplyGsmOptions,
): ConnectorResult {
  const { settings } = batch;
  const result = transaction(db, () => {
    const upsertLine = db.prepare(
      `INSERT INTO raw_gsm_lines (id, game_id, game_name, line_text, timestamp, language, note_ids,
         last_modified, payload, synced_at, removed_at, device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (id) DO UPDATE SET game_id = excluded.game_id, game_name = excluded.game_name,
         line_text = excluded.line_text, timestamp = excluded.timestamp, language = excluded.language,
         note_ids = excluded.note_ids, last_modified = excluded.last_modified, payload = excluded.payload,
         synced_at = excluded.synced_at, removed_at = NULL`,
    );
    for (const line of batch.lines) {
      upsertLine.run(
        line.id,
        line.game_id,
        line.game_name,
        line.line_text,
        line.timestamp,
        line.language,
        line.note_ids,
        lineVersion(line.last_modified, line.timestamp),
        JSON.stringify(line),
        now,
        device,
      );
    }
    const markRemoved = db.prepare("UPDATE raw_gsm_lines SET removed_at = ? WHERE id = ? AND device = ?");
    for (const id of batch.removed) markRemoved.run(now, id, device);

    // Covers: rewritten only when an image changes; a game of this computer that lost its image loses its
    // cover. A cover the user chose is never touched; one Mosaik found gives way. (Before the games are replaced, to know this
    // computer's games of last time.)
    const upsertCover = db.prepare(
      `INSERT INTO covers (content_id, mime, data, etag, fetched_at, origin) VALUES (?, ?, ?, ?, ?, 'gsm')
       ON CONFLICT (content_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
         etag = excluded.etag, fetched_at = excluded.fetched_at, origin = 'gsm'
       WHERE covers.origin IN ('gsm', 'steam-auto')`,
    );
    for (const { gameId, image, etag } of batch.covers) {
      const cover = decodeCover(image);
      if (cover) upsertCover.run(gsmContentId(gameId, null), cover.mime, cover.data, etag, now);
    }
    db.prepare(
      `DELETE FROM covers WHERE origin = 'gsm'
         AND content_id IN (SELECT 'gsm:' || id FROM raw_gsm_games WHERE device = ?)
         AND content_id NOT IN (SELECT 'gsm:' || value FROM json_each(?))`,
    ).run(device, JSON.stringify(batch.coverGames));

    // Games and breaks are few: compare and replace them whole
    const gamesBefore = JSON.stringify(
      db
        .prepare("SELECT id, payload FROM raw_gsm_games WHERE device = ? ORDER BY id")
        .all(device)
        .map((row) => [row.id, row.payload]),
    );
    const games = [...batch.games].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const gamesNow = JSON.stringify(games.map((game) => [game.id, JSON.stringify(game)]));
    const gamesChanged = gamesBefore !== gamesNow;
    if (gamesChanged) {
      db.prepare("DELETE FROM raw_gsm_games WHERE device = ?").run(device);
      const insertGame = db.prepare(
        "INSERT INTO raw_gsm_games (id, payload, synced_at, device) VALUES (?, ?, ?, ?)",
      );
      for (const game of games) insertGame.run(game.id, JSON.stringify(game), now, device);
    }

    const breaksBefore = (
      db.prepare("SELECT timestamp FROM raw_gsm_breaks WHERE device = ? ORDER BY timestamp").all(device) as {
        timestamp: number;
      }[]
    ).map((row) => row.timestamp);
    const breaksNow = [...new Set(batch.breaks)].sort((a, b) => a - b);
    const breaksChanged = JSON.stringify(breaksBefore) !== JSON.stringify(breaksNow);
    if (breaksChanged) {
      db.prepare("DELETE FROM raw_gsm_breaks WHERE device = ?").run(device);
      const insertBreak = db.prepare("INSERT INTO raw_gsm_breaks (device, timestamp) VALUES (?, ?)");
      for (const timestamp of breaksNow) insertBreak.run(device, timestamp);
    }

    const changed =
      batch.lines.length > 0 ||
      batch.removed.length > 0 ||
      gamesChanged ||
      breaksChanged ||
      !sameSettings(cursorSettings(cursor), settings);
    if (!changed) {
      return null;
    }
    // Each computer's lines count with its own GSM settings: this one's just arrived, the others' are in
    // the cursor each one left
    const others = new Map<string, GsmSettings>();
    for (const row of db
      .prepare("SELECT device, cursor FROM connector_state WHERE source = 'gsm' AND device != ?")
      .all(device) as { device: string; cursor: string | null }[]) {
      const saved = cursorSettings(row.cursor ? (JSON.parse(row.cursor) as JsonValue) : null);
      if (saved) others.set(row.device, saved);
    }
    const deriveOptions = (chosen: GsmSettings) => ({
      sessionGapSeconds: chosen.sessionGapSeconds,
      text: {
        punctuation: punctuationRegex(chosen.extraPunctuationRegex),
        regexOutRepetitions: chosen.regexOutRepetitions,
      },
    });
    const derived = rebuildGsm(db, (lineDevice) =>
      deriveOptions(lineDevice === device ? settings : (others.get(lineDevice) ?? DEFAULT_GSM_STATS)),
    );
    // New note_ids change where cards come from
    rebuildCards(db, attribution);
    return derived;
  });

  const totals = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM lines WHERE source = 'gsm') AS lines,
              (SELECT COUNT(*) FROM sessions WHERE source = 'gsm') AS sessions,
              (SELECT COALESCE(SUM(seconds), 0) FROM sessions WHERE source = 'gsm') AS seconds,
              (SELECT COUNT(*) FROM cards WHERE origin = 'gsm') AS cards`,
    )
    .get() as { lines: number; sessions: number; seconds: number; cards: number };

  return {
    cursor: { settings: { ...settings } },
    summary: {
      lines: totals.lines,
      linesUpdated: batch.lines.length,
      linesRemoved: batch.removed.length,
      sessions: totals.sessions,
      readingSeconds: Math.round(totals.seconds),
      cardsFromGsm: totals.cards,
      rebuilt: result !== null,
    },
  };
}

/** Local mode: read this computer's gsm.db and apply it right away. */
export function createGsmConnector({ db, locate, attribution, timeZone }: GsmConnectorOptions): Connector {
  return {
    source: GSM_SOURCE,

    async run({ cursor, now }): Promise<ConnectorResult> {
      const batch = readGsm(locate(), knownGsm(db), timeZone);
      return applyGsm(db, batch, { cursor, attribution, now: now() });
    },
  };
}
