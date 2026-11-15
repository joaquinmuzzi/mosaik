/**
 * The HTTP server: the API under `/api` and, once built, the dashboard as static files.
 *
 * It listens on 127.0.0.1 only. Two checks keep web pages out, since any page open in the browser
 * can send requests to localhost:
 * - the Host header must name this computer, so a site that points its own domain at 127.0.0.1
 *   (DNS rebinding) cannot talk to the hub;
 * - requests that change something must come from this computer's pages, from a browser extension,
 *   or from a program (no Origin header). The API sends no CORS headers, so other pages cannot read
 *   its answers either.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type {
  AnkiStatsResponse,
  HealthResponse,
  OverviewResponse,
  SourceStatus,
  SourcesResponse,
} from "@mosaik/shared";
import { contentDetail, listContents, searchLines } from "./api/contents.ts";
import { getCover } from "./api/covers.ts";
import { ankiStats, dayDetail, isDay, overview } from "./api/dashboard.ts";
import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from "fastify";
import type { Config } from "./config.ts";
import { listConnectorStates } from "./connectors/state.ts";
import type { Database } from "./db/database.ts";
import { schemaVersion } from "./db/migrate.ts";
import { INGEST_BODY_LIMIT, ingestEvents } from "./ingest.ts";
import type { Scheduler } from "./scheduler.ts";

/** The dashboard built by Vite (`packages/web/dist`), both from `src/` and from `dist/`. */
export const WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** `127.0.0.1:7300` → `127.0.0.1`, `[::1]:7300` → `[::1]`. */
function hostnameOf(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    return end === -1 ? lower : lower.slice(0, end + 1);
  }
  return lower.split(":")[0] ?? lower;
}

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOSTNAMES.has(hostnameOf(host));
}

/** Pages of this computer (the hub itself, the Vite dev server) and browser extensions. */
export function isTrustedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }
  if (origin.startsWith("chrome-extension://")) {
    return true;
  }
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && isLoopbackHost(url.host);
  } catch {
    return false;
  }
}

export interface ServerOptions {
  config: Config;
  db: Database;
  scheduler: Scheduler;
  /** Folder of the built dashboard; it is served only if it exists. */
  webDistDir?: string;
  logger?: FastifyServerOptions["logger"];
}

export async function buildServer({
  config,
  db,
  scheduler,
  webDistDir = WEB_DIST_DIR,
  logger = false,
}: ServerOptions): Promise<FastifyInstance> {
  // The dashboard polls the API: one log line per request would bury everything else
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }) });
  const version = readVersion();

  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHost(request.headers.host)) {
      return reply.code(403).send({ error: "forbidden_host" });
    }
    if (!SAFE_METHODS.has(request.method) && !isTrustedOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    name: "mosaik",
    version,
    schemaVersion: schemaVersion(db),
    now: Date.now(),
  }));

  app.get("/api/sources", async (): Promise<SourcesResponse> => {
    const states = new Map(listConnectorStates(db).map((state) => [state.source, state]));
    const names = new Set([...scheduler.sources(), ...states.keys()]);
    const sources: SourceStatus[] = [...names].sort().map((source) => {
      const state = states.get(source);
      return {
        source,
        registered: scheduler.has(source),
        running: scheduler.isRunning(source),
        lastRunAt: state?.lastRunAt ?? null,
        lastOkAt: state?.lastOkAt ?? null,
        lastError: state?.lastError ?? null,
        lastSummary: state?.lastSummary ?? null,
      };
    });
    return { sources };
  });

  const dashboard = {
    timeZone: config.timeZone,
    cutoffHour: config.dayCutoffHour,
    targetLanguage: config.targetLanguage,
    youtubeThumbnails: config.youtubeThumbnails,
  };

  app.get<{ Querystring: { days?: string } }>("/api/overview", async (request): Promise<OverviewResponse> => {
    const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 366);
    return overview(db, dashboard, days);
  });

  app.get<{ Params: { day: string } }>("/api/days/:day", async (request, reply) => {
    if (!isDay(request.params.day)) {
      return reply.code(400).send({ error: "invalid_day", message: "Use YYYY-MM-DD" });
    }
    return dayDetail(db, dashboard, request.params.day);
  });

  app.get("/api/anki", async (): Promise<AnkiStatsResponse> => ankiStats(db, dashboard));

  app.get("/api/contents", async () => listContents(db, dashboard));

  app.get<{ Params: { id: string } }>("/api/contents/:id/cover", async (request, reply) => {
    const cover = await getCover(db, request.params.id, { youtubeThumbnails: config.youtubeThumbnails });
    if (!cover) return reply.code(404).send({ error: "not_found", message: "No cover" });
    return reply
      .header("Content-Type", cover.mime)
      .header("Cache-Control", "private, max-age=86400")
      .send(Buffer.from(cover.data));
  });

  app.get<{ Params: { id: string } }>("/api/contents/:id", async (request, reply) => {
    const detail = contentDetail(db, dashboard, request.params.id);
    return detail ?? reply.code(404).send({ error: "not_found", message: "No such content" });
  });

  app.get<{ Querystring: { q?: string; limit?: string; content?: string } }>(
    "/api/search",
    async (request) => {
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 500);
      return searchLines(db, dashboard, request.query.q ?? "", {
        limit,
        ...(request.query.content ? { contentId: request.query.content } : {}),
      });
    },
  );

  app.post("/api/sync", async () => ({ results: await scheduler.runAll() }));

  app.post("/api/ingest/events", { bodyLimit: INGEST_BODY_LIMIT }, async (request, reply) => {
    const result = ingestEvents(db, request.body, {
      attribution: { refoldDecks: config.ankiRefoldDecks, timeZone: config.timeZone },
      timeZone: config.timeZone,
    });
    return reply.code(result.status).send(result.body);
  });

  app.post<{ Params: { source: string } }>("/api/sync/:source", async (request, reply) => {
    const { source } = request.params;
    if (!scheduler.has(source)) {
      return reply.code(404).send({ error: "unknown_source", message: `No connector for "${source}"` });
    }
    return scheduler.run(source);
  });

  const hasDashboard = existsSync(join(webDistDir, "index.html"));
  if (hasDashboard) {
    await app.register(fastifyStatic, { root: webDistDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      request.url.startsWith("/api/") ||
      request.url === "/api" ||
      !hasDashboard ||
      request.method !== "GET"
    ) {
      return reply.code(404).send({ error: "not_found" });
    }
    // Any other page is a route of the dashboard
    return reply.sendFile("index.html");
  });

  app.log.debug({ port: config.port, hasDashboard }, "server ready");
  return app;
}
