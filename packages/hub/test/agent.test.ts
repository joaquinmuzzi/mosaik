import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SourcesResponse } from "@mosaik/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.ts";
import { listContents } from "../src/api/contents.ts";
import { createAnkiClient } from "../src/connectors/anki/client.ts";
import { type Database, openDatabase } from "../src/db/database.ts";
import { applyMigrations } from "../src/db/migrate.ts";
import { createScheduler } from "../src/scheduler.ts";
import { buildServer } from "../src/server.ts";
import { FakeAnki } from "./fake-anki.ts";
import { FakeGsm, type LineInput } from "./fake-gsm.ts";
import { silentLogger, tempDir, testConfig } from "./helpers.ts";

const SITE = "https://mosaik.test";
const T = 1_794_326_400;
const TZ = "America/Buenos_Aires";
const DECKS = ["German Mining", "Refold Alemán-mil"];

let app: FastifyInstance | undefined;
let db: Database | undefined;

afterEach(async () => {
  await app?.close();
  db?.close();
  app = undefined;
  db = undefined;
});

/** A fetch that reaches the test server without a network (and can be told to fail). */
function injectFetch(server: FastifyInstance, fail?: (url: URL, method: string) => boolean): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (fail?.(url, method)) throw new TypeError("fetch failed");
    const response = await server.inject({
      method: method as "GET" | "POST",
      url: url.pathname + url.search,
      headers: { ...(init?.headers as Record<string, string>), host: "mosaik.test" },
      ...(init?.body ? { payload: init.body as string } : {}),
    });
    return new Response(response.body, { status: response.statusCode });
  }) as typeof fetch;
}

async function startServer() {
  db = openDatabase(":memory:");
  applyMigrations(db);
  app = await buildServer({
    config: testConfig({
      mode: "server",
      host: "0.0.0.0",
      publicUrl: SITE,
      setupToken: "setup-token-0123456789",
    }),
    db,
    scheduler: createScheduler({ db, intervalMs: 60_000, log: silentLogger }),
    webDistDir: join(tempDir(), "missing"),
  });
  const setup = await app.inject({
    method: "POST",
    url: "/api/auth/setup",
    headers: { host: "mosaik.test", origin: SITE },
    payload: { token: "setup-token-0123456789", username: "joaquin", password: "correct horse battery" },
  });
  const cookie = String(setup.headers["set-cookie"]).split(";")[0]!;
  const tokenFor = async (name: string) => {
    const response = await app!.inject({
      method: "POST",
      url: "/api/devices",
      headers: { host: "mosaik.test", origin: SITE, cookie },
      payload: { name },
    });
    return response.json<{ token: string }>().token;
  };
  return { server: app, cookie, tokenFor };
}

const line = (id: string, gameId: string, title: string, offset: number): LineInput => ({
  id,
  gameId,
  gameName: title,
  text: "Ein kurzer Satz.",
  timestamp: T + offset,
});

function fakeGsm(gameId: string, title: string, ids: string[], start = 0): FakeGsm {
  const gsm = new FakeGsm(tempDir());
  gsm.addGame(gameId, title);
  gsm.addLines(ids.map((id, index) => line(id, gameId, title, start + index * 10)));
  return gsm;
}

function agentFor(
  server: FastifyInstance,
  token: string,
  sources: { gsm?: FakeGsm; anki?: FakeAnki },
  fail?: (url: URL, method: string) => boolean,
) {
  const outboxDir = join(tempDir(), "outbox");
  const agent = createAgent({
    serverUrl: SITE,
    token,
    outboxDir,
    log: silentLogger,
    fetchImpl: injectFetch(server, fail),
    ...(sources.gsm
      ? {
          gsm: {
            locate: () => ({ dbPath: sources.gsm!.dbPath, dataDir: sources.gsm!.dataDir }),
            timeZone: TZ,
          },
        }
      : {}),
    ...(sources.anki
      ? {
          anki: {
            client: createAnkiClient({ url: "http://127.0.0.1:8765", fetchImpl: sources.anki.fetch }),
            decks: DECKS,
          },
        }
      : {}),
  });
  return { agent, outboxDir };
}

const count = (sql: string) => (db!.prepare(sql).get() as { n: number }).n;

describe("the agent", () => {
  it("sends this computer's Anki and GSM, and next time only what is new", async () => {
    const { server, tokenFor } = await startServer();
    const gsm = fakeGsm("game-a", "Beispiel Spiel", ["a1", "a2", "a3"]);
    const { agent } = agentFor(server, await tokenFor("notebook"), { gsm, anki: new FakeAnki() });

    const first = await agent.runOnce();
    expect(first).toMatchObject({ ok: true, offline: false, fatal: null, errors: [], queued: 0 });
    expect(first.sent.map((entry) => entry.source)).toEqual(["anki", "gsm"]);
    expect(count("SELECT COUNT(*) AS n FROM raw_gsm_lines WHERE device = 'notebook'")).toBe(3);
    const reviews = count("SELECT COUNT(*) AS n FROM raw_anki_reviews");
    expect(reviews).toBeGreaterThan(0);

    gsm.addLines([line("a4", "game-a", "Beispiel Spiel", 40)]);
    const second = await agent.runOnce();
    expect(second.ok).toBe(true);
    expect(second.sent.find((entry) => entry.source === "gsm")?.summary).toMatchObject({ linesUpdated: 1 });
    expect(second.sent.find((entry) => entry.source === "anki")?.summary).toMatchObject({ reviewsNew: 0 });
    expect(count("SELECT COUNT(*) AS n FROM raw_gsm_lines")).toBe(4);
    expect(count("SELECT COUNT(*) AS n FROM raw_anki_reviews")).toBe(reviews);
  });

  it("keeps a batch it could not deliver in the outbox and sends it next time", async () => {
    const { server, tokenFor } = await startServer();
    const gsm = fakeGsm("game-a", "Beispiel Spiel", ["a1", "a2"]);
    let down = true;
    const { agent, outboxDir } = agentFor(
      server,
      await tokenFor("notebook"),
      { gsm },
      (url, method) => down && method === "POST" && url.pathname === "/api/agent/batches",
    );

    const failed = await agent.runOnce();
    expect(failed).toMatchObject({ ok: false, offline: true, queued: 1 });
    expect(readdirSync(outboxDir).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    expect(count("SELECT COUNT(*) AS n FROM raw_gsm_lines")).toBe(0);

    down = false;
    const recovered = await agent.runOnce();
    expect(recovered).toMatchObject({ ok: true, flushed: 1, queued: 0 });
    expect(count("SELECT COUNT(*) AS n FROM raw_gsm_lines")).toBe(2);
  });

  it("reads nothing while the server cannot be reached, and loses nothing", async () => {
    const { server, tokenFor } = await startServer();
    const gsm = fakeGsm("game-a", "Beispiel Spiel", ["a1"]);
    let down = true;
    const { agent } = agentFor(server, await tokenFor("notebook"), { gsm }, () => down);
    expect(await agent.runOnce()).toMatchObject({ ok: false, offline: true, queued: 0, sent: [] });
    gsm.addLines([line("a2", "game-a", "Beispiel Spiel", 10)]);
    down = false;
    expect(await agent.runOnce()).toMatchObject({ ok: true });
    expect(count("SELECT COUNT(*) AS n FROM raw_gsm_lines")).toBe(2);
  });

  it("reports a source it cannot read, and still sends the others", async () => {
    const { server, cookie, tokenFor } = await startServer();
    const gsm = fakeGsm("game-a", "Beispiel Spiel", ["a1"]);
    const closedAnki = {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    } as FakeAnki;
    const { agent } = agentFor(server, await tokenFor("notebook"), { gsm, anki: closedAnki });

    const run = await agent.runOnce();
    expect(run.ok).toBe(false);
    expect(run.errors).toEqual([{ source: "anki", error: expect.stringMatching(/Anki/) }]);
    expect(run.sent.map((entry) => entry.source)).toEqual(["gsm"]);

    const sources = (
      await server.inject({ url: "/api/sources", headers: { host: "mosaik.test", cookie } })
    ).json<SourcesResponse>().sources;
    expect(
      sources.find((source) => source.source === "anki" && source.device === "notebook")?.lastError,
    ).toMatch(/Anki/);
  });

  it("stops for good when its token is revoked", async () => {
    const { server, cookie, tokenFor } = await startServer();
    const gsm = fakeGsm("game-a", "Beispiel Spiel", ["a1"]);
    const { agent } = agentFor(server, await tokenFor("notebook"), { gsm });
    await server.inject({
      method: "DELETE",
      url: "/api/devices/notebook",
      headers: { host: "mosaik.test", origin: SITE, cookie },
    });
    const run = await agent.runOnce();
    expect(run.fatal).toMatch(/rejected this computer's token/);
    expect((await agent.runOnce()).sent).toEqual([]);
  });

  it("does not send Anki's reviews again from a second computer", async () => {
    const { server, tokenFor } = await startServer();
    const first = agentFor(server, await tokenFor("principal"), { anki: new FakeAnki() });
    await first.agent.runOnce();
    const reviews = count("SELECT COUNT(*) AS n FROM raw_anki_reviews");

    const second = agentFor(server, await tokenFor("notebook"), { anki: new FakeAnki() });
    const run = await second.agent.runOnce();
    expect(run.sent[0]?.summary).toMatchObject({ reviewsNew: 0, notesUpdated: 0, cardsUpdated: 0 });
    expect(count("SELECT COUNT(*) AS n FROM raw_anki_reviews")).toBe(reviews);
  });

  it("counts the same game read on two computers as one content", async () => {
    const { server, tokenFor } = await startServer();
    // GSM gives the game a different id on each computer; the title is the same
    const principal = fakeGsm("id-on-desktop", "Phoenix Wright: Ace Attorney Trilogy", ["p1", "p2", "p3"]);
    const notebook = fakeGsm("id-on-notebook", "Phoenix Wright: Ace Attorney Trilogy", ["n1", "n2"], 86_400);
    await agentFor(server, await tokenFor("principal"), { gsm: principal }).agent.runOnce();
    await agentFor(server, await tokenFor("notebook"), { gsm: notebook }).agent.runOnce();

    const options = { timeZone: TZ, cutoffHour: 4, targetLanguage: "de" };
    const games = listContents(db!, options).contents.filter((content) => content.kind === "game");
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      id: "gsm:id-on-desktop",
      title: "Phoenix Wright: Ace Attorney Trilogy",
    });
    expect(count("SELECT COUNT(*) AS n FROM lines WHERE content_id = 'gsm:id-on-desktop'")).toBe(5);
    expect(
      count("SELECT COUNT(DISTINCT device) AS n FROM sessions WHERE content_id = 'gsm:id-on-desktop'"),
    ).toBe(2);
  });
});
