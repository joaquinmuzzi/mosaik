/**
 * The GameSentenceMiner connector: copies the lines, games and reading breaks of `gsm.db` into the raw
 * tables, then rebuilds the GSM sessions, lines and contents, and the origin of the cards.
 *
 * GSM edits lines after creating them (it fills `note_ids` when a card is mined), so lines are compared
 * by their `last_modified`, not by time: every run lists all line ids with their versions (cheap) and
 * fetches the new and changed rows only. A line that leaves `game_lines` was deleted, unless GSM
 * archived its day, in which case GSM still counts it and so does Mosaik.
 */
import { createHash } from "node:crypto";
import { dayKey } from "@mosaik/shared";
import type { Database } from "../../db/database.ts";
import { transaction } from "../../db/database.ts";
import { type AttributionOptions, rebuildCards } from "../../derive/cards.ts";
import { GSM_SOURCE, gsmContentId, rebuildGsm } from "../../derive/gsm.ts";
import type { Connector, ConnectorResult, JsonValue } from "../types.ts";
import { punctuationRegex } from "./reading-time.ts";
import {
  type GsmLocation,
  type GsmStatsSettings,
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

interface Cursor {
  settings: GsmStatsSettings | null;
}

function parseCursor(cursor: JsonValue | null): Cursor {
  if (cursor && typeof cursor === "object" && !Array.isArray(cursor)) {
    const settings = cursor.settings;
    if (settings && typeof settings === "object" && !Array.isArray(settings)) {
      return { settings: settings as unknown as GsmStatsSettings };
    }
  }
  return { settings: null };
}

const sameSettings = (a: GsmStatsSettings | null, b: GsmStatsSettings) =>
  a !== null &&
  a.sessionGapSeconds === b.sessionGapSeconds &&
  a.regexOutRepetitions === b.regexOutRepetitions &&
  a.extraPunctuationRegex === b.extraPunctuationRegex;

export function createGsmConnector({ db, locate, attribution, timeZone }: GsmConnectorOptions): Connector {
  return {
    source: GSM_SOURCE,

    async run({ cursor, now }): Promise<ConnectorResult> {
      const { dbPath, dataDir } = locate();
      const settings = readGsmStatsSettings(dataDir);

      const stored = new Map(
        (
          db
            .prepare("SELECT id, last_modified, removed_at IS NOT NULL AS removed FROM raw_gsm_lines")
            .all() as {
            id: string;
            last_modified: number;
            removed: number;
          }[]
        ).map((row) => [row.id, row]),
      );

      const gsm = openGsmReadOnly(dbPath);
      let snapshot;
      try {
        snapshot = readGsmSnapshot(gsm, (id, version) => {
          const row = stored.get(id);
          return !row || row.last_modified !== version || row.removed === 1;
        });
      } finally {
        gsm.close();
      }

      // Lines gone from GSM: deleted, unless their day was archived (GSM days start at local midnight)
      const removed: string[] = [];
      const storedTimes = db.prepare("SELECT game_id, timestamp FROM raw_gsm_lines WHERE id = ?");
      for (const [id, row] of stored) {
        if (row.removed === 1 || snapshot.lineVersions.has(id)) continue;
        const line = storedTimes.get(id) as { game_id: string | null; timestamp: number };
        const day = dayKey(line.timestamp * 1000, timeZone, 0);
        if (!snapshot.archivedDays.has(`${line.game_id ?? ""}|${day}`)) removed.push(id);
      }

      const syncedAt = now();
      const previous = parseCursor(cursor);
      const result = transaction(db, () => {
        const upsertLine = db.prepare(
          `INSERT INTO raw_gsm_lines (id, game_id, game_name, line_text, timestamp, language, note_ids,
             last_modified, payload, synced_at, removed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT (id) DO UPDATE SET game_id = excluded.game_id, game_name = excluded.game_name,
             line_text = excluded.line_text, timestamp = excluded.timestamp, language = excluded.language,
             note_ids = excluded.note_ids, last_modified = excluded.last_modified, payload = excluded.payload,
             synced_at = excluded.synced_at, removed_at = NULL`,
        );
        for (const line of snapshot.lines) {
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
            syncedAt,
          );
        }
        const markRemoved = db.prepare("UPDATE raw_gsm_lines SET removed_at = ? WHERE id = ?");
        for (const id of removed) markRemoved.run(syncedAt, id);

        // Games and breaks are few: compare and replace them whole
        const gamesBefore = JSON.stringify(
          db
            .prepare("SELECT id, payload FROM raw_gsm_games ORDER BY id")
            .all()
            .map((row) => [row.id, row.payload]),
        );
        const gamesNow = JSON.stringify(snapshot.games.map((game) => [game.id, JSON.stringify(game)]));
        const gamesChanged = gamesBefore !== gamesNow;
        if (gamesChanged) {
          db.exec("DELETE FROM raw_gsm_games");
          const insertGame = db.prepare(
            "INSERT INTO raw_gsm_games (id, payload, synced_at) VALUES (?, ?, ?)",
          );
          for (const game of snapshot.games) insertGame.run(game.id, JSON.stringify(game), syncedAt);
        }
        // Covers: rewritten only when an image changes; a game that lost its image loses its cover
        const coverEtag = db.prepare("SELECT etag FROM covers WHERE content_id = ?");
        const upsertCover = db.prepare(
          `INSERT INTO covers (content_id, mime, data, etag, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (content_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
             etag = excluded.etag, fetched_at = excluded.fetched_at`,
        );
        for (const [gameId, image] of snapshot.covers) {
          const etag = createHash("sha1").update(image).digest("hex");
          const known = coverEtag.get(gsmContentId(gameId, null)) as { etag: string } | undefined;
          if (known?.etag === etag) continue;
          const cover = decodeCover(image);
          if (cover) upsertCover.run(gsmContentId(gameId, null), cover.mime, cover.data, etag, syncedAt);
        }
        const keep = JSON.stringify([...snapshot.covers.keys()].map((gameId) => gsmContentId(gameId, null)));
        db.prepare(
          "DELETE FROM covers WHERE content_id LIKE 'gsm:%' AND content_id NOT IN (SELECT value FROM json_each(?))",
        ).run(keep);

        const breaksBefore = (
          db.prepare("SELECT timestamp FROM raw_gsm_breaks ORDER BY timestamp").all() as {
            timestamp: number;
          }[]
        ).map((row) => row.timestamp);
        const breaksChanged = JSON.stringify(breaksBefore) !== JSON.stringify(snapshot.breaks);
        if (breaksChanged) {
          db.exec("DELETE FROM raw_gsm_breaks");
          const insertBreak = db.prepare("INSERT OR IGNORE INTO raw_gsm_breaks (timestamp) VALUES (?)");
          for (const timestamp of snapshot.breaks) insertBreak.run(timestamp);
        }

        const changed =
          snapshot.lines.length > 0 ||
          removed.length > 0 ||
          gamesChanged ||
          breaksChanged ||
          !sameSettings(previous.settings, settings);
        if (!changed) {
          return null;
        }
        const derived = rebuildGsm(db, {
          sessionGapSeconds: settings.sessionGapSeconds,
          text: {
            punctuation: punctuationRegex(settings.extraPunctuationRegex),
            regexOutRepetitions: settings.regexOutRepetitions,
          },
        });
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
          linesUpdated: snapshot.lines.length,
          linesRemoved: removed.length,
          sessions: totals.sessions,
          readingSeconds: Math.round(totals.seconds),
          cardsFromGsm: totals.cards,
          rebuilt: result !== null,
        },
      };
    },
  };
}
