import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthResponse, SourcesResponse } from "@mosaik/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations, schemaVersion } from "../src/db/migrate.ts";
import { type Scheduler, createScheduler } from "../src/scheduler.ts";
import { buildServer, isLoopbackHost, isTrustedOrigin } from "../src/server.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const HOST = { host: "127.0.0.1:7300" };

let app: FastifyInstance | undefined;
let db: Database | undefined;

afterEach(async () => {
  await app?.close();
  db?.close();
  app = undefined;
  db = undefined;
});

async function setup(options: { webDistDir?: string; register?: (scheduler: Scheduler) => void } = {}) {
  db = openDatabase(":memory:");
  applyMigrations(db);
  const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
  options.register?.(scheduler);
  app = await buildServer({
    config: testConfig(),
    db,
    scheduler,
    webDistDir: options.webDistDir ?? join(tempDir(), "missing"),
  });
  return { app, db, scheduler };
}

describe("GET /api/health", () => {
  it("answers with the name, version and schema", async () => {
    const { app, db } = await setup();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: HOST });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body).toMatchObject({ status: "ok", name: "mosaik", schemaVersion: schemaVersion(db) });
    expect(typeof body.version).toBe("string");
    expect(body.schemaVersion).toBeGreaterThan(0);
  });

  it("refuses requests whose Host is not this computer (DNS rebinding)", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example:7300" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden_host" });
  });

  it("sends no CORS headers, so other pages cannot read it", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { ...HOST, origin: "https://evil.example" },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("sources and sync", () => {
  it("lists registered connectors and the ones with saved state", async () => {
    const { app, db } = await setup({
      register: (scheduler) =>
        scheduler.register({ source: "anki", run: async () => ({ summary: { notes: 3 } }) }),
    });
    db.prepare("INSERT INTO connector_state (source, last_error) VALUES ('old', 'gone')").run();

    await app.inject({ method: "POST", url: "/api/sync/anki", headers: HOST });
    const response = await app.inject({ method: "GET", url: "/api/sources", headers: HOST });
    const { sources } = response.json<SourcesResponse>();
    expect(sources.map((source) => [source.source, source.registered])).toEqual([
      ["anki", true],
      ["old", false],
    ]);
    expect(sources[0]).toMatchObject({ lastError: null, lastSummary: { notes: 3 }, running: false });
    expect(sources[0]!.lastOkAt).toEqual(expect.any(Number));
    expect(sources[1]).toMatchObject({ lastError: "gone", lastOkAt: null });
  });

  it("runs a connector on demand and reports its failure", async () => {
    const { app } = await setup({
      register: (scheduler) =>
        scheduler.register({
          source: "anki",
          run: async () => {
            throw new Error("Anki is not running");
          },
        }),
    });
    const response = await app.inject({ method: "POST", url: "/api/sync/anki", headers: HOST });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ source: "anki", ok: false, error: "Anki is not running" });
  });

  it("answers 404 for a source without a connector", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "POST", url: "/api/sync/nope", headers: HOST });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "unknown_source" });
  });

  it("refuses changes requested by other web pages", async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...HOST, origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden_origin" });
  });

  it("accepts changes from the dashboard, extensions and programs", async () => {
    const { app } = await setup();
    for (const origin of ["http://127.0.0.1:5173", "chrome-extension://abcdefghijklmnop", undefined]) {
      const headers = origin ? { ...HOST, origin } : HOST;
      const response = await app.inject({ method: "POST", url: "/api/sync", headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ results: [] });
    }
  });
});

describe("the dashboard", () => {
  it("is served when it was built, with its routes falling back to index.html", async () => {
    const dist = join(tempDir(), "dist");
    mkdirSync(dist);
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Mosaik</title>");
    const { app } = await setup({ webDistDir: dist });

    const root = await app.inject({ method: "GET", url: "/", headers: HOST });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>Mosaik</title>");

    const route = await app.inject({ method: "GET", url: "/anki", headers: HOST });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain("<title>Mosaik</title>");

    const api = await app.inject({ method: "GET", url: "/api/nothing", headers: HOST });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: "not_found" });
  });

  it("is not required: without a build, unknown pages are 404", async () => {
    const { app } = await setup();
    const response = await app.inject({ method: "GET", url: "/", headers: HOST });
    expect(response.statusCode).toBe(404);
  });
});

describe("listening", () => {
  it("binds to 127.0.0.1 only", async () => {
    const { app } = await setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    expect(address).toMatchObject({ address: "127.0.0.1" });
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(response.status).toBe(200);
  });
});

describe("isLoopbackHost / isTrustedOrigin", () => {
  it("recognise this computer", () => {
    expect(isLoopbackHost("127.0.0.1:7300")).toBe(true);
    expect(isLoopbackHost("LOCALHOST:7300")).toBe(true);
    expect(isLoopbackHost("[::1]:7300")).toBe(true);
    expect(isLoopbackHost("127.0.0.1.evil.example")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  it("trust local pages, extensions and requests without origin", () => {
    expect(isTrustedOrigin(undefined)).toBe(true);
    expect(isTrustedOrigin("http://localhost:5173")).toBe(true);
    expect(isTrustedOrigin("chrome-extension://abcdefghijklmnop")).toBe(true);
    expect(isTrustedOrigin("https://127.0.0.1")).toBe(false);
    expect(isTrustedOrigin("https://evil.example")).toBe(false);
    expect(isTrustedOrigin("null")).toBe(false);
  });
});
