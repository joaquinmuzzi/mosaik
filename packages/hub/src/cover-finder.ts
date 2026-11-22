/**
 * Looks for the covers that contents lack, in the background. Each way is off until the user turns it
 * on, because it tells somebody what they watch or play:
 * - `WEB_COVERS`: the page of what Deuchan counted outside YouTube is opened and its image is kept.
 * - `STEAM_COVERS`: Steam is asked for the title of a game, and the cover is kept only if one Steam game
 *   has exactly that title.
 *
 * Each content is asked about once. When nothing was found it is tried again, each time later, and then
 * no more. A cover the user removed is not looked for again.
 */
import { listContents } from "./api/contents.ts";
import { storeFoundCover } from "./api/covers.ts";
import type { DashboardOptions } from "./api/dashboard.ts";
import { type FrontPages, findPageCover } from "./api/page-covers.ts";
import { findSteamCover } from "./api/steam.ts";
import type { Logger } from "./connectors/types.ts";
import type { Database } from "./db/database.ts";
import { type PublicGet, getPublic } from "./public-http.ts";

/** Searches per round, so that a long history does not become a burst of requests. */
export const MAX_SEARCHES = 10;

export const MAX_ATTEMPTS = 8;

const MINUTE = 60_000;

/**
 * How long after a search that found nothing the next one is: 5 min, 20 min, 80 min... up to a week. The
 * first ones are soon because Twitch answers with its logo until it has prepared the page.
 */
export const retryAfter = (attempts: number) =>
  Math.min(5 * MINUTE * 4 ** (attempts - 1), 7 * 24 * 60 * MINUTE);

/** A window title instead of a game: GSM reading from a browser. Its text is not sent to Steam. */
const BROWSER_WINDOW =
  /\s[-–—]\s(YouTube|Brave|Google Chrome|Chromium|Mozilla Firefox|Opera|Vivaldi|.*Microsoft\P{L}*Edge)\s*$/iu;

export interface CoverFinderOptions {
  db: Database;
  dashboard: DashboardOptions;
  webCovers: boolean;
  steamCovers: boolean;
  intervalMs: number;
  log: Logger;
  now?: () => number;
  get?: PublicGet;
  fetchImpl?: typeof fetch;
}

export interface CoverRound {
  searched: number;
  found: number;
}

export interface CoverFinder {
  /** One round. Never rejects. */
  run(): Promise<CoverRound>;
  start(): void;
  /** Stops the rounds, and waits for the search in progress. */
  stop(): Promise<void>;
}

type Result = "found" | "none" | "error" | "dismissed";

interface Search {
  content_id: string;
  result: Result;
  searched_at: number;
  attempts: number;
}

interface Target {
  id: string;
  via: "web" | "steam-auto";
  /** The page's address, or the game's title. */
  what: string;
}

export function createCoverFinder(options: CoverFinderOptions): CoverFinder {
  const { db, log, now = Date.now, get = getPublic, fetchImpl = fetch } = options;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<CoverRound> | null = null;
  let stopped = false;

  function due(search: Search | undefined): boolean {
    // A cover that was found and is gone was replaced by another, which is gone too
    if (!search || search.result === "found") return true;
    if (search.result === "dismissed" || search.attempts >= MAX_ATTEMPTS) return false;
    return now() - search.searched_at >= retryAfter(search.attempts);
  }

  function targets(): Target[] {
    const searches = new Map(
      (
        db
          .prepare("SELECT content_id, result, searched_at, attempts FROM cover_searches")
          .all() as unknown as Search[]
      ).map((row) => [row.content_id, row]),
    );
    const urls = new Map(
      (
        db
          .prepare("SELECT id, json_extract(meta, '$.url') AS url FROM contents WHERE source = 'deuchan'")
          .all() as { id: string; url: string | null }[]
      ).map((row) => [row.id, row.url]),
    );
    const found: Target[] = [];
    // Newest first, and only what the library shows
    for (const content of listContents(db, options.dashboard).contents) {
      if (content.coverSource !== null || !due(searches.get(content.id))) continue;
      if (content.source === "deuchan" && options.webCovers && !content.id.startsWith("yt:")) {
        const url = urls.get(content.id);
        if (url) found.push({ id: content.id, via: "web", what: url });
      } else if (content.kind === "game" && options.steamCovers && content.title) {
        if (!BROWSER_WINDOW.test(content.title))
          found.push({ id: content.id, via: "steam-auto", what: content.title });
      }
    }
    return found;
  }

  function record(id: string, result: Result, error: string | null): void {
    db.prepare(
      `INSERT INTO cover_searches (content_id, searched_at, result, attempts, error) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (content_id) DO UPDATE SET searched_at = excluded.searched_at, result = excluded.result,
         attempts = CASE WHEN cover_searches.result = 'found' THEN 1 ELSE cover_searches.attempts + 1 END,
         error = excluded.error
       WHERE cover_searches.result != 'dismissed'`,
    ).run(id, now(), result, error);
  }

  async function round(): Promise<CoverRound> {
    let searched = 0;
    let found = 0;
    try {
      const frontPages: FrontPages = new Map();
      for (const target of targets().slice(0, MAX_SEARCHES)) {
        if (stopped) break;
        searched += 1;
        let data: Uint8Array | null = null;
        let failure: string | null = null;
        try {
          data =
            target.via === "web"
              ? await findPageCover(target.what, get, frontPages)
              : await findSteamCover(target.what, fetchImpl);
        } catch (error) {
          failure = (error instanceof Error ? error.message || error.name : String(error)).slice(0, 300);
        }
        if (data && storeFoundCover(db, target.id, data, target.via, now())) {
          found += 1;
          record(target.id, "found", null);
        } else {
          record(target.id, failure === null ? "none" : "error", failure);
        }
      }
      if (searched > 0) log.info({ searched, found }, "covers looked for");
    } catch (error) {
      log.error({ error: error instanceof Error ? error.message : String(error) }, "cover search failed");
    }
    return { searched, found };
  }

  function run(): Promise<CoverRound> {
    inFlight ??= round().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    run,
    start() {
      if (timer || (!options.webCovers && !options.steamCovers)) return;
      void run();
      timer = setInterval(() => void run(), options.intervalMs);
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await inFlight;
    },
  };
}
