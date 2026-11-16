/**
 * The HTTP server: the API under `/api` and, once built, the dashboard as static files.
 *
 * In server mode (MOSAIK_MODE=server) it answers only for PUBLIC_URL's host and asks for a login: the
 * dashboard's API needs a session cookie (and changes must come from its own page), agents and Deuchan
 * send with a device token, and only `/api/health` is open (the host's health check uses it).
 *
 * In local mode it listens on 127.0.0.1 only. Two checks keep web pages out, since any page open in the
 * browser can send requests to localhost:
 * - the Host header must name this computer, so a site that points its own domain at 127.0.0.1
 *   (DNS rebinding) cannot talk to the hub;
 * - requests that change something must come from this computer's pages, from a browser extension,
 *   or from a program (no Origin header). The API sends no CORS headers, so other pages cannot read
 *   its answers either.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type {
  AgentBatchResponse,
  AnkiStatsResponse,
  AuthStatusResponse,
  CreateDeviceResponse,
  DevicesResponse,
  HealthResponse,
  OverviewResponse,
  SourceStatus,
  SourcesResponse,
  StatsResponse,
} from "@mosaik/shared";
import { DEFAULT_DEVICE, connectorBatchSchema, dayKey, deviceSchema } from "@mosaik/shared";
import { AGENT_BODY_LIMIT, agentState, applyAgentBatch, reportAgentError } from "./api/agent.ts";
import {
  LoginLimiter,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_DAYS,
  bearerToken,
  checkSession,
  createAccount,
  createDevice,
  createSession,
  deleteSession,
  deviceForToken,
  getAccount,
  listDevices,
  readCookie,
  revokeDevice,
  sameSecret,
  verifyPassword,
} from "./auth.ts";
import { contentDetail, listContents, searchLines } from "./api/contents.ts";
import { MAX_COVER_BYTES, getCover, removeManualCover, setManualCover } from "./api/covers.ts";
import { searchSteam, setSteamCover } from "./api/steam.ts";
import { ankiStats, dayDetail, isDay, overview } from "./api/dashboard.ts";
import { backupDatabase, cardsCsv, contentsCsv, daysCsv } from "./api/export.ts";
import { stats } from "./api/stats.ts";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
  LogController,
} from "fastify";
import type { Config } from "./config.ts";
import { listConnectorStates } from "./connectors/state.ts";
import type { Database } from "./db/database.ts";
import { IMPORT_SUFFIX, looksLikeSqlite } from "./db/import.ts";
import { schemaVersion } from "./db/migrate.ts";
import { INGEST_BODY_LIMIT, ingestEvents } from "./ingest.ts";
import type { Scheduler } from "./scheduler.ts";

/** The dashboard built by Vite (`packages/web/dist`), both from `src/` and from `dist/`. */
export const WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * What the dashboard may load: its own files, covers through the API, and Steam's images in the cover
 * picker. Inline styles stay allowed: Svelte and ECharts set style attributes.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.steamstatic.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const pathOf = (url: string) => url.split("?")[0] ?? url;

/** Up to 512 MB for the one-time import of an existing database. */
const IMPORT_BODY_LIMIT = 512 * 1024 * 1024;

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
  const server = config.mode === "server";
  const publicUrl = server && config.publicUrl ? new URL(config.publicUrl) : null;
  if (server && !publicUrl) throw new Error("Server mode needs PUBLIC_URL");
  // The dashboard polls the API: one log line per request would bury everything else.
  // Behind the host's proxy, the client's address is the last one the proxy added.
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    // Trusts the first hop only (the host's proxy), so a client cannot fake its address
    ...(server ? { trustProxy: (_address: string, hop: number) => hop === 0 } : {}),
  });
  const version = readVersion();
  // Requests from an agent or Deuchan: the device their token belongs to
  const deviceOf = new WeakMap<object, string>();
  const sessionOf = (cookieHeader: string | undefined) => readCookie(cookieHeader, SESSION_COOKIE);

  app.addHook("onRequest", async (request, reply) => {
    if (!server) {
      if (!isLoopbackHost(request.headers.host)) {
        return reply.code(403).send({ error: "forbidden_host" });
      }
      if (!SAFE_METHODS.has(request.method) && !isTrustedOrigin(request.headers.origin)) {
        return reply.code(403).send({ error: "forbidden_origin" });
      }
      return;
    }
    const path = pathOf(request.url);
    // The host's health check comes with a host of its own, and the answer says nothing private
    if (path === "/api/health") return;
    if ((request.headers.host ?? "").toLowerCase() !== publicUrl!.host) {
      return reply.code(403).send({ error: "forbidden_host" });
    }
    // The dashboard's files are public; the page asks for a login itself
    if (!path.startsWith("/api/")) return;
    // Moving the old database here, once: only with the setup token, and only before the account exists
    if (path === "/api/admin/import") {
      const token = bearerToken(request.headers.authorization);
      if (!config.setupToken || !token || !sameSecret(token, config.setupToken)) {
        return reply.code(401).send({ error: "invalid_setup_token" });
      }
      if (getAccount(db)) return reply.code(409).send({ error: "already_set_up" });
      return;
    }
    if (path.startsWith("/api/agent/") || path === "/api/ingest/events") {
      const token = bearerToken(request.headers.authorization);
      const device = token ? deviceForToken(db, token, Date.now()) : null;
      if (!device) return reply.code(401).send({ error: "invalid_device_token" });
      deviceOf.set(request, device);
      return;
    }
    // The rest is the dashboard's, with a cookie: changes must come from its own page
    if (!SAFE_METHODS.has(request.method) && request.headers.origin !== publicUrl!.origin) {
      return reply.code(403).send({ error: "forbidden_origin" });
    }
    if (path.startsWith("/api/auth/")) return;
    const token = sessionOf(request.headers.cookie);
    if (!token || !checkSession(db, token, Date.now())) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    if (publicUrl?.protocol === "https:") {
      reply.header("Strict-Transport-Security", "max-age=31536000");
    }
    return payload;
  });

  // Login (server mode). Local mode has none: its status always says "authenticated".
  const limiter = new LoginLimiter();
  // Over every address together: bounds guessing even from many addresses at once
  const globalLimiter = new LoginLimiter(30);
  const cookie = (token: string, maxAge: number) =>
    [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
      ...(publicUrl?.protocol === "https:" ? ["Secure"] : []),
    ].join("; ");
  const startSession = (reply: FastifyReply, userAgent: string | undefined) =>
    reply.header("Set-Cookie", cookie(createSession(db, Date.now(), userAgent), SESSION_DAYS * 86_400));
  const blocked = (ip: string, now: number) =>
    Math.max(limiter.blockedFor(ip, now), globalLimiter.blockedFor("all", now));
  const failed = (ip: string, now: number) => {
    limiter.fail(ip, now);
    globalLimiter.fail("all", now);
  };
  const tooMany = (reply: FastifyReply, wait: number) =>
    reply.code(429).send({ error: "too_many_attempts", retryAfterSeconds: Math.ceil(wait / 1000) });

  app.get("/api/auth/status", async (request): Promise<AuthStatusResponse> => {
    if (!server) return { mode: "local", authenticated: true, setupNeeded: false, username: null };
    const account = getAccount(db);
    const token = sessionOf(request.headers.cookie);
    const authenticated = account !== null && token !== null && checkSession(db, token, Date.now());
    return {
      mode: "server",
      authenticated,
      setupNeeded: account === null,
      username: authenticated && account ? account.username : null,
    };
  });

  const credentials = (body: unknown) => {
    const value = (body ?? {}) as Record<string, unknown>;
    return {
      username: typeof value.username === "string" ? value.username.trim() : "",
      password: typeof value.password === "string" ? value.password : "",
      token: typeof value.token === "string" ? value.token : "",
    };
  };

  if (server) {
    app.post("/api/auth/setup", async (request, reply) => {
      const now = Date.now();
      if (getAccount(db)) return reply.code(409).send({ error: "already_set_up" });
      if (!config.setupToken) return reply.code(403).send({ error: "setup_disabled" });
      const wait = blocked(request.ip, now);
      if (wait > 0) return tooMany(reply, wait);
      const { username, password, token } = credentials(request.body);
      if (!sameSecret(token, config.setupToken)) {
        failed(request.ip, now);
        return reply.code(403).send({ error: "invalid_setup_token" });
      }
      if (username.length < 1 || username.length > 64) {
        return reply.code(400).send({ error: "invalid_username" });
      }
      if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
        return reply.code(400).send({ error: "weak_password", minLength: MIN_PASSWORD_LENGTH });
      }
      await createAccount(db, username, password, now);
      startSession(reply, request.headers["user-agent"]);
      return { ok: true };
    });

    app.post("/api/auth/login", async (request, reply) => {
      const now = Date.now();
      const account = getAccount(db);
      if (!account) return reply.code(409).send({ error: "setup_needed" });
      const wait = blocked(request.ip, now);
      if (wait > 0) return tooMany(reply, wait);
      const { username, password } = credentials(request.body);
      // The password is checked even with a wrong name, so both take the same time
      const passwordOk = await verifyPassword(password, account.passwordHash);
      if (!passwordOk || !sameSecret(username, account.username)) {
        failed(request.ip, now);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      limiter.succeed(request.ip);
      startSession(reply, request.headers["user-agent"]);
      return { ok: true };
    });

    app.post("/api/auth/logout", async (request, reply) => {
      const token = sessionOf(request.headers.cookie);
      if (token) deleteSession(db, token);
      return reply.header("Set-Cookie", cookie("", 0)).send({ ok: true });
    });

    // Devices: one token per computer that sends data
    app.get("/api/devices", async (): Promise<DevicesResponse> => ({ devices: listDevices(db) }));

    app.post("/api/devices", async (request, reply) => {
      const parsed = deviceSchema.safeParse(((request.body ?? {}) as { name?: unknown }).name);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_name", message: parsed.error.issues[0]?.message });
      }
      const result = createDevice(db, parsed.data, Date.now());
      if (!result.ok) return reply.code(409).send({ error: result.error });
      const response: CreateDeviceResponse = { name: parsed.data, token: result.token };
      return response;
    });

    app.delete<{ Params: { name: string } }>("/api/devices/:name", async (request) => ({
      revoked: revokeDevice(db, request.params.name, Date.now()),
    }));

    // Agents
    app.get<{ Querystring: { source?: string } }>("/api/agent/state", async (request, reply) => {
      const source = request.query.source;
      if (source !== "gsm" && source !== "anki") return reply.code(400).send({ error: "invalid_source" });
      return agentState(db, deviceOf.get(request)!, source);
    });

    app.post("/api/agent/batches", { bodyLimit: AGENT_BODY_LIMIT }, async (request, reply) => {
      const parsed = connectorBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({
          error: "invalid_batch",
          message: issue ? `${issue.path.join(".") || "(body)"}: ${issue.message}` : "invalid",
        });
      }
      const device = deviceOf.get(request)!;
      const result = applyAgentBatch(db, config, device, parsed.data, Date.now());
      const response: AgentBatchResponse = { ok: true, device, summary: result.summary ?? null };
      return response;
    });

    // The old database, as a file: it waits next to the database and takes its place at the next start
    app.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: IMPORT_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
    app.post("/api/admin/import", { bodyLimit: IMPORT_BODY_LIMIT }, async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body) || !looksLikeSqlite(body)) {
        return reply.code(400).send({ error: "not_a_database", message: "Send a Mosaik database (SQLite)" });
      }
      writeFileSync(`${config.dbPath}${IMPORT_SUFFIX}`, body);
      return reply.code(202).send({ ok: true, bytes: body.length, next: "restart the server to use it" });
    });

    // A source the agent could not read (Anki closed, GSM missing): shown in Fuentes for that computer
    app.post("/api/agent/report", async (request, reply) => {
      const body = (request.body ?? {}) as { source?: unknown; error?: unknown };
      if ((body.source !== "gsm" && body.source !== "anki") || typeof body.error !== "string") {
        return reply.code(400).send({ error: "invalid_report" });
      }
      reportAgentError(db, deviceOf.get(request)!, body.source, body.error);
      return { ok: true };
    });
  }

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    name: "mosaik",
    version,
    schemaVersion: schemaVersion(db),
    now: Date.now(),
  }));

  // One row per source and computer; the hub's own connectors (local mode) are listed even before
  // their first run
  app.get("/api/sources", async (): Promise<SourcesResponse> => {
    const states = listConnectorStates(db);
    const own = (source: string, device: string) => device === DEFAULT_DEVICE && scheduler.has(source);
    const sources: SourceStatus[] = states.map((state) => ({
      source: state.source,
      device: state.device,
      registered: own(state.source, state.device),
      running: own(state.source, state.device) && scheduler.isRunning(state.source),
      lastRunAt: state.lastRunAt,
      lastOkAt: state.lastOkAt,
      lastError: state.lastError,
      lastSummary: state.lastSummary,
    }));
    for (const source of scheduler.sources()) {
      if (!states.some((state) => state.source === source && state.device === DEFAULT_DEVICE)) {
        sources.push({
          source,
          device: DEFAULT_DEVICE,
          registered: true,
          running: scheduler.isRunning(source),
          lastRunAt: null,
          lastOkAt: null,
          lastError: null,
          lastSummary: null,
        });
      }
    }
    sources.sort((a, b) => a.source.localeCompare(b.source) || a.device.localeCompare(b.device));
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

  app.get("/api/stats", async (): Promise<StatsResponse> => stats(db, dashboard));

  // Downloads: the file name carries today's date, and nothing is cached
  const download = (reply: FastifyReply, name: string, type: string, body: string | Buffer) => {
    const today = dayKey(Date.now(), dashboard.timeZone, dashboard.cutoffHour);
    const [base, extension] = name.split(".") as [string, string];
    return reply
      .header("Content-Type", type)
      .header("Content-Disposition", `attachment; filename="mosaik-${base}-${today}.${extension}"`)
      .header("Cache-Control", "no-store")
      .send(body);
  };
  const CSV = "text/csv; charset=utf-8";
  app.get("/api/export/days.csv", async (_request, reply) =>
    download(reply, "dias.csv", CSV, daysCsv(db, dashboard)),
  );
  app.get("/api/export/contents.csv", async (_request, reply) =>
    download(reply, "contenidos.csv", CSV, contentsCsv(db, dashboard)),
  );
  app.get("/api/export/cards.csv", async (_request, reply) =>
    download(reply, "tarjetas.csv", CSV, cardsCsv(db, dashboard)),
  );
  app.get("/api/export/backup", async (_request, reply) =>
    download(reply, "backup.sqlite", "application/vnd.sqlite3", backupDatabase(db)),
  );

  app.get<{ Params: { id: string } }>("/api/contents/:id/cover", async (request, reply) => {
    const cover = await getCover(db, request.params.id, { youtubeThumbnails: config.youtubeThumbnails });
    if (!cover) return reply.code(404).send({ error: "not_found", message: "No cover" });
    return reply
      .header("Content-Type", cover.mime)
      .header("Cache-Control", "private, max-age=86400")
      .send(Buffer.from(cover.data));
  });

  // A cover the user chose: the image itself is the body
  app.addContentTypeParser(
    /^image\//,
    { parseAs: "buffer", bodyLimit: MAX_COVER_BYTES + 1024 },
    (_request, body, done) => done(null, body),
  );

  app.put<{ Params: { id: string }; Body: Buffer }>("/api/contents/:id/cover", async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ error: "unsupported_media_type", message: "Send the image itself" });
    }
    const result = setManualCover(db, request.params.id, new Uint8Array(request.body));
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { ok: true };
  });

  // Steam: searched only when the user asks, with the title they typed
  app.get<{ Querystring: { q?: string } }>("/api/covers/steam", async (request, reply) => {
    try {
      return { results: await searchSteam(request.query.q ?? "") };
    } catch (error) {
      return reply.code(502).send({
        error: "steam_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { appId?: unknown } }>(
    "/api/contents/:id/cover/steam",
    async (request, reply) => {
      const appId = Number(request.body?.appId);
      if (!Number.isSafeInteger(appId) || appId <= 0)
        return reply.code(400).send({ error: "invalid_app_id" });
      const result = await setSteamCover(db, request.params.id, appId);
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/contents/:id/cover", async (request) => ({
    removed: removeManualCover(db, request.params.id),
  }));

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
