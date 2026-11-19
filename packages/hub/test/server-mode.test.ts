import type { AgentState, AuthStatusResponse, SourcesResponse } from "@mosaik/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { gsmKnownFromJson } from "../src/api/agent.ts";
import { readGsm } from "../src/connectors/gsm/connector.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { FakeGsm } from "./fake-gsm.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const SITE = "https://mosaik.test";
const SETUP_TOKEN = "setup-token-0123456789";
const PASSWORD = "correct horse battery";
const T = 1_794_326_400;

let app: FastifyInstance | undefined;
let db: Database | undefined;

afterEach(async () => {
  await app?.close();
  db?.close();
  app = undefined;
  db = undefined;
});

async function setup(mode: "server" | "local" = "server") {
  db = openDatabase(":memory:");
  applyMigrations(db);
  const scheduler = createScheduler({ db, intervalMs: 60_000, log: silentLogger });
  app = await buildServer({
    config: testConfig(
      mode === "server" ? { mode, host: "0.0.0.0", publicUrl: SITE, setupToken: SETUP_TOKEN } : {},
    ),
    db,
    scheduler,
    webDistDir: `${tempDir()}/missing`,
  });
  return app;
}

/** Headers of the dashboard's own page, plus a cookie when there is one. */
const page = (cookie?: string) => ({
  host: "mosaik.test",
  origin: SITE,
  ...(cookie ? { cookie } : {}),
});

/** `name=value` of the session cookie a response set. */
function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = String(response.headers["set-cookie"]);
  return header.split(";")[0]!;
}

async function createAccount(server: FastifyInstance): Promise<string> {
  const response = await server.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: page(),
    payload: { token: SETUP_TOKEN, username: "joaquin", password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response);
}

describe("server mode", () => {
  it("answers only for its host, keeps the API behind a login, and leaves the health check open", async () => {
    const server = await setup();
    const health = await server.inject({ url: "/api/health", headers: { host: "healthcheck.railway.app" } });
    expect(health.statusCode).toBe(200);

    expect((await server.inject({ url: "/api/overview", headers: { host: "evil.test" } })).statusCode).toBe(
      403,
    );
    const anonymous = await server.inject({ url: "/api/overview", headers: { host: "mosaik.test" } });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthenticated" });
    expect((await server.inject({ url: "/api/export/backup", headers: page() })).statusCode).toBe(401);
  });

  it("creates the account once, with the setup token, and logs in right away", async () => {
    const server = await setup();
    const status = await server.inject({ url: "/api/auth/status", headers: page() });
    expect(status.json<AuthStatusResponse>()).toEqual({
      mode: "server",
      authenticated: false,
      setupNeeded: true,
      username: null,
    });

    const body = { token: SETUP_TOKEN, username: "joaquin", password: PASSWORD };
    const wrong = await server.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: page(),
      payload: { ...body, token: "not-the-token-at-all" },
    });
    expect(wrong.statusCode).toBe(403);
    const fromElsewhere = await server.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: { host: "mosaik.test", origin: "https://evil.test" },
      payload: body,
    });
    expect(fromElsewhere.statusCode).toBe(403);
    const weak = await server.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: page(),
      payload: { ...body, password: "short" },
    });
    expect(weak.statusCode).toBe(400);

    const created = await server.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: page(),
      payload: body,
    });
    expect(created.statusCode).toBe(200);
    const setCookie = String(created.headers["set-cookie"]);
    expect(setCookie).toMatch(/^mosaik_session=mks_[\w-]{43};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const cookie = sessionCookie(created);
    const after = await server.inject({ url: "/api/auth/status", headers: page(cookie) });
    expect(after.json<AuthStatusResponse>()).toMatchObject({ authenticated: true, username: "joaquin" });
    expect((await server.inject({ url: "/api/overview", headers: page(cookie) })).statusCode).toBe(200);

    const again = await server.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: page(),
      payload: body,
    });
    expect(again.statusCode).toBe(409);
  });

  it("logs in and out, and makes a guesser wait after a few failures", async () => {
    const server = await setup();
    await createAccount(server);
    const login = (password: string, remoteAddress = "203.0.113.5") =>
      server.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: page(),
        remoteAddress,
        payload: { username: "joaquin", password },
      });

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login("wrong password!")).statusCode).toBe(401);
    }
    const blocked = await login(PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: "too_many_attempts" });

    // Another address can still log in
    const ok = await login(PASSWORD, "198.51.100.7");
    expect(ok.statusCode).toBe(200);
    const cookie = sessionCookie(ok);
    expect((await server.inject({ url: "/api/sources", headers: page(cookie) })).statusCode).toBe(200);

    const out = await server.inject({ method: "POST", url: "/api/auth/logout", headers: page(cookie) });
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await server.inject({ url: "/api/sources", headers: page(cookie) })).statusCode).toBe(401);
  });

  it("refuses changes with a session cookie that do not come from its own page", async () => {
    const server = await setup();
    const cookie = await createAccount(server);
    const noOrigin = await server.inject({
      method: "POST",
      url: "/api/devices",
      headers: { host: "mosaik.test", cookie },
      payload: { name: "notebook" },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json()).toEqual({ error: "forbidden_origin" });
  });

  it("sends the security headers", async () => {
    const server = await setup();
    const response = await server.inject({ url: "/api/health", headers: page() });
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("devices and agents", () => {
  async function withDevice(name = "notebook") {
    const server = await setup();
    const cookie = await createAccount(server);
    const created = await server.inject({
      method: "POST",
      url: "/api/devices",
      headers: page(cookie),
      payload: { name },
    });
    expect(created.statusCode).toBe(200);
    const { token } = created.json<{ name: string; token: string }>();
    expect(token).toMatch(/^mkd_[\w-]{43}$/);
    return { server, cookie, agent: { host: "mosaik.test", authorization: `Bearer ${token}` } };
  }

  it("creates a device token once, lists devices without it, and refuses bad or repeated names", async () => {
    const { server, cookie } = await withDevice();
    const list = await server.inject({ url: "/api/devices", headers: page(cookie) });
    expect(list.json()).toEqual({
      devices: [
        { name: "notebook", label: null, createdAt: expect.any(Number), lastSeenAt: null, revokedAt: null },
      ],
    });
    const repeated = await server.inject({
      method: "POST",
      url: "/api/devices",
      headers: page(cookie),
      payload: { name: "notebook" },
    });
    expect(repeated.statusCode).toBe(409);
    const bad = await server.inject({
      method: "POST",
      url: "/api/devices",
      headers: page(cookie),
      payload: { name: "../etc" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("gives an agent its state and applies its batches as its device, only once", async () => {
    const { server, cookie, agent } = await withDevice();
    expect(
      (await server.inject({ url: "/api/agent/state?source=gsm", headers: { host: "mosaik.test" } }))
        .statusCode,
    ).toBe(401);

    const first = await server.inject({ url: "/api/agent/state?source=gsm", headers: agent });
    expect(first.statusCode).toBe(200);
    const state = first.json<AgentState>();
    expect(state).toMatchObject({ source: "gsm", device: "notebook", cursor: null });

    const gsm = new FakeGsm(tempDir());
    gsm.addGame("game-b", "Anderes Spiel");
    gsm.addLines(
      [0, 10, 20].map((offset) => ({
        id: `b${offset}`,
        gameId: "game-b",
        gameName: "Anderes Spiel",
        text: "Ein kurzer Satz.",
        timestamp: T + offset,
      })),
    );
    const known = state.source === "gsm" ? gsmKnownFromJson(state.known) : null;
    const batch = readGsm({ dbPath: gsm.dbPath, dataDir: gsm.dataDir }, known!, "America/Buenos_Aires");

    const sent = await server.inject({
      method: "POST",
      url: "/api/agent/batches",
      headers: agent,
      payload: batch,
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({
      ok: true,
      device: "notebook",
      summary: { linesUpdated: 3, rebuilt: true },
    });
    const again = await server.inject({
      method: "POST",
      url: "/api/agent/batches",
      headers: agent,
      payload: batch,
    });
    expect(again.statusCode).toBe(200);
    expect(db!.prepare("SELECT COUNT(*) AS n FROM raw_gsm_lines WHERE device = 'notebook'").get()).toEqual({
      n: 3,
    });

    // Next time the agent knows what the server has, and finds nothing new
    const next = (
      await server.inject({ url: "/api/agent/state?source=gsm", headers: agent })
    ).json<AgentState>();
    expect(next.cursor).not.toBeNull();
    const nothing = readGsm(
      { dbPath: gsm.dbPath, dataDir: gsm.dataDir },
      next.source === "gsm" ? gsmKnownFromJson(next.known) : known!,
      "America/Buenos_Aires",
    );
    expect(nothing.lines).toEqual([]);

    const sources = (
      await server.inject({ url: "/api/sources", headers: page(cookie) })
    ).json<SourcesResponse>();
    expect(sources.sources).toEqual([
      expect.objectContaining({ source: "gsm", device: "notebook", registered: false, lastError: null }),
    ]);
  });

  it("shows a device by its label, keeping its name for its data", async () => {
    const { server, cookie, agent } = await withDevice();
    const relabel = (name: string, label: unknown) =>
      server.inject({
        method: "PATCH",
        url: `/api/devices/${name}`,
        headers: page(cookie),
        payload: { label },
      });
    const labelled = await relabel("notebook", "PC1");
    expect(labelled.json()).toEqual({ name: "notebook", label: "PC1" });
    expect((await relabel("nowhere", "PC1")).statusCode).toBe(404);
    expect((await relabel("notebook", "../etc")).statusCode).toBe(400);

    const list = await server.inject({ url: "/api/devices", headers: page(cookie) });
    expect(list.json().devices[0]).toMatchObject({ name: "notebook", label: "PC1" });
    // The token still is the device, by its name
    expect((await server.inject({ url: "/api/agent/whoami", headers: agent })).json()).toEqual({
      device: "notebook",
    });
    await server.inject({
      method: "POST",
      url: "/api/agent/report",
      headers: agent,
      payload: { source: "gsm", error: "no gsm.db" },
    });
    const sources = (
      await server.inject({ url: "/api/sources", headers: page(cookie) })
    ).json<SourcesResponse>();
    expect(sources.sources).toEqual([
      expect.objectContaining({ source: "gsm", device: "notebook", deviceLabel: "PC1" }),
    ]);

    await relabel("notebook", null);
    expect(
      (await server.inject({ url: "/api/devices", headers: page(cookie) })).json().devices[0],
    ).toMatchObject({
      label: null,
    });
  });

  it("says which device a token is", async () => {
    const { server, agent } = await withDevice("deuchan");
    const answer = await server.inject({ url: "/api/agent/whoami", headers: agent });
    expect(answer.json()).toEqual({ device: "deuchan" });
    expect(
      (await server.inject({ url: "/api/agent/whoami", headers: { host: "mosaik.test" } })).statusCode,
    ).toBe(401);
  });

  it("refuses a malformed batch and a revoked token", async () => {
    const { server, cookie, agent } = await withDevice();
    const malformed = await server.inject({
      method: "POST",
      url: "/api/agent/batches",
      headers: agent,
      payload: { source: "gsm", version: 1, lines: "nope" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: "invalid_batch" });

    const revoked = await server.inject({
      method: "DELETE",
      url: "/api/devices/notebook",
      headers: page(cookie),
    });
    expect(revoked.json()).toEqual({ revoked: true });
    expect((await server.inject({ url: "/api/agent/state?source=anki", headers: agent })).statusCode).toBe(
      401,
    );
  });

  it("does not let a device token into the dashboard's API", async () => {
    const { server, agent } = await withDevice();
    expect((await server.inject({ url: "/api/overview", headers: agent })).statusCode).toBe(401);
  });
});

describe("local mode", () => {
  it("has no login and no agent endpoints", async () => {
    const server = await setup("local");
    const status = await server.inject({ url: "/api/auth/status", headers: { host: "127.0.0.1:7300" } });
    expect(status.json<AuthStatusResponse>()).toEqual({
      mode: "local",
      authenticated: true,
      setupNeeded: false,
      username: null,
    });
    expect(
      (await server.inject({ url: "/api/overview", headers: { host: "127.0.0.1:7300" } })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ url: "/api/agent/state?source=gsm", headers: { host: "127.0.0.1:7300" } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "POST", url: "/api/auth/login", headers: { host: "127.0.0.1:7300" } }))
        .statusCode,
    ).toBe(404);
  });
});
