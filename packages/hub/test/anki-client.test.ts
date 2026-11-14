import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnkiConnectError,
  CARD_FIELDS,
  READ_ACTIONS,
  type ReadAction,
  assertReadAction,
  createAnkiClient,
  deckQuery,
} from "../src/connectors/anki/client.ts";
import { FakeAnki } from "./fake-anki.ts";

const URL_ = "http://127.0.0.1:8765";

function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
  return async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
}

async function rejection(promise: Promise<unknown>): Promise<AnkiConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AnkiConnectError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe("createAnkiClient", () => {
  it("speaks AnkiConnect version 6 and returns the result", async () => {
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: URL_, fetchImpl: anki.fetch });
    expect(await client.version()).toBe(6);
    expect(await client.deckNamesAndIds()).toMatchObject({ "German Mining": 1786000000001 });
    expect(await client.findNotes(deckQuery("Refold Alemán-mil"))).toEqual([1660000000560, 1660000000561]);
  });

  it("asks cardsInfo only for scheduling fields, not the rendered card", async () => {
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: URL_, fetchImpl: anki.fetch });
    const [card] = await client.cardsInfo([1787000000001]);
    expect(anki.actions.at(-1)?.params?.fields).toEqual(CARD_FIELDS);
    expect(Object.keys(card!)).not.toContain("question");
    expect(card).toMatchObject({ cardId: 1787000000001, interval: 30, deckName: "German Mining" });
  });

  it("keeps the {} that stands for an id Anki does not have", async () => {
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: URL_, fetchImpl: anki.fetch });
    expect(await client.notesModTime([1787000000000, 42])).toEqual([
      { noteId: 1787000000000, mod: 1787000100 },
      {},
    ]);
  });

  it("splits long id lists into batches", async () => {
    const anki = new FakeAnki();
    const client = createAnkiClient({ url: URL_, fetchImpl: anki.fetch, batchSize: 2 });
    const result = await client.notesModTime([1, 2, 3, 4, 5]);
    expect(result).toHaveLength(5);
    expect(anki.actions.map((entry) => (entry.params?.notes as number[]).length)).toEqual([2, 2, 1]);
  });

  it("only knows read actions, and refuses anything else", () => {
    for (const action of [
      "deleteNotes",
      "updateNoteFields",
      "insertReviews",
      "addNote",
      "answerCards",
      "setDueDate",
    ]) {
      expect(READ_ACTIONS).not.toContain(action as ReadAction);
      expect(() => assertReadAction(action)).toThrow(AnkiConnectError);
    }
    expect(() => assertReadAction("cardReviews")).not.toThrow();
  });

  it("reports an AnkiConnect error", async () => {
    const client = createAnkiClient({
      url: URL_,
      fetchImpl: respond({ result: null, error: "collection is not available" }),
    });
    const error = await rejection(client.version());
    expect(error.kind).toBe("api");
    expect(error.message).toContain("collection is not available");
  });

  it("says Anki is not open when nothing listens", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    const client = createAnkiClient({ url: `http://127.0.0.1:${port}` });
    const error = await rejection(client.version());
    expect(error.kind).toBe("unreachable");
    expect(error.message).toMatch(/Anki is not open/);
  });

  it("gives up after the timeout", async () => {
    server = createServer(() => {
      // Never answers
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const client = createAnkiClient({ url: `http://127.0.0.1:${port}`, timeoutMs: 50 });
    const error = await rejection(client.version());
    expect(error.kind).toBe("timeout");
    server.closeAllConnections();
  });

  it("rejects HTTP errors, invalid JSON and unexpected shapes", async () => {
    expect(
      (await rejection(createAnkiClient({ url: URL_, fetchImpl: respond("", { status: 500 }) }).version()))
        .kind,
    ).toBe("http");
    expect(
      (await rejection(createAnkiClient({ url: URL_, fetchImpl: respond("not json") }).version())).kind,
    ).toBe("invalid_response");
    expect(
      (
        await rejection(
          createAnkiClient({ url: URL_, fetchImpl: respond({ result: "six", error: null }) }).version(),
        )
      ).kind,
    ).toBe("invalid_response");
    expect(
      (
        await rejection(
          createAnkiClient({
            url: URL_,
            fetchImpl: respond({ result: [[1, 2, 3]], error: null }),
          }).cardReviews("D", 0),
        )
      ).kind,
    ).toBe("invalid_response");
  });

  it("rejects an answer with a different number of items than ids asked for", async () => {
    const client = createAnkiClient({ url: URL_, fetchImpl: respond({ result: [], error: null }) });
    expect((await rejection(client.notesModTime([1, 2]))).kind).toBe("invalid_response");
  });
});

describe("deckQuery", () => {
  it("quotes the deck and escapes Anki's wildcards", () => {
    expect(deckQuery("German Mining")).toBe('deck:"German Mining"');
    expect(deckQuery("Refold Alemán-mil")).toBe('deck:"Refold Alemán-mil"');
    expect(deckQuery('My_deck* "x"')).toBe('deck:"My\\_deck\\* \\"x\\""');
  });
});
