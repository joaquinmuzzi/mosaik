import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ingestBatchSchema, parseIngestEvent } from "../src/ingest.ts";

const interval = {
  id: "deuchan:iv:1b0e4c8e-0000-4000-8000-000000000001",
  source: "deuchan",
  kind: "watch_interval",
  language: "de",
  from: 1_763_100_000_000,
  to: 1_763_100_120_000,
  seconds: 118.5,
  videoId: "dQw4w9WgXcQ",
  title: "Easy German 500",
};

describe("parseIngestEvent", () => {
  it("accepts a watch interval", () => {
    expect(parseIngestEvent(interval)).toEqual({ ok: true, event: interval });
  });

  it("accepts a day total with its videos", () => {
    const event = {
      id: "deuchan:day:2026-11-14:1763150000000",
      source: "deuchan",
      kind: "day_total",
      language: "de",
      day: "2026-11-14",
      at: 1_763_150_000_000,
      seconds: 5430,
      videos: [{ videoId: "dQw4w9WgXcQ", title: "Easy German 500", seconds: 1200 }],
    };
    expect(parseIngestEvent(event)).toEqual({ ok: true, event });
  });

  it("accepts a removed video", () => {
    const event = {
      id: "deuchan:rm:2026-11-14:dQw4w9WgXcQ:1763150000000",
      source: "deuchan",
      kind: "video_removed",
      day: "2026-11-14",
      at: 1_763_150_000_000,
      videoId: "dQw4w9WgXcQ",
    };
    expect(parseIngestEvent(event)).toEqual({ ok: true, event });
  });

  it("accepts an item of another site, or read by hand, instead of a YouTube video", () => {
    const { videoId: _, ...rest } = interval;
    const web = { ...rest, itemId: "web:3f2a", url: "https://www.twitch.tv/videos/1", site: "twitch.tv" };
    expect(parseIngestEvent(web)).toEqual({ ok: true, event: web });
    const reading = { ...web, contentKind: "reading" };
    expect(parseIngestEvent(reading)).toEqual({ ok: true, event: reading });
    expect(parseIngestEvent(rest)).toMatchObject({ ok: false, error: expect.stringContaining("itemId") });
    expect(parseIngestEvent({ ...web, url: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(parseIngestEvent({ ...web, itemId: "no namespace" })).toMatchObject({ ok: false });
  });

  it("accepts a day total with reading time and items of other sites", () => {
    const event = {
      id: "deuchan:day:2026-11-14:1",
      source: "deuchan",
      kind: "day_total",
      language: "de",
      day: "2026-11-14",
      at: 1_763_150_000_000,
      seconds: 600,
      readingSeconds: 300,
      videos: [{ itemId: "web:comic", title: "Asterix", contentKind: "reading", seconds: 300 }],
    };
    expect(parseIngestEvent(event)).toEqual({ ok: true, event });
  });

  it("rejects an interval that ends before it starts, keeping its id", () => {
    const result = parseIngestEvent({ ...interval, to: interval.from - 1 });
    expect(result).toMatchObject({ ok: false, id: interval.id });
    expect(result.ok === false && result.error).toContain("to");
  });

  it("rejects more seconds than the interval lasts", () => {
    expect(parseIngestEvent({ ...interval, seconds: 300 }).ok).toBe(false);
  });

  it("rejects timestamps that are not milliseconds", () => {
    // Microseconds by mistake land after the year 2100
    expect(parseIngestEvent({ ...interval, from: interval.from * 1000, to: interval.to * 1000 }).ok).toBe(
      false,
    );
  });

  it("rejects unknown kinds and things that are not events", () => {
    expect(parseIngestEvent({ ...interval, kind: "something_else" }).ok).toBe(false);
    expect(parseIngestEvent("hello")).toMatchObject({ ok: false });
    expect(parseIngestEvent(null)).toMatchObject({ ok: false });
  });
});

describe("ingestBatchSchema", () => {
  it("requires between 1 and 500 events", () => {
    expect(ingestBatchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(ingestBatchSchema.safeParse({ events: [interval] }).success).toBe(true);
    expect(ingestBatchSchema.safeParse({ events: Array(501).fill(interval) }).success).toBe(false);
  });
});

describe("docs/ingest-api.md", () => {
  it("has an example that the schema accepts", () => {
    const doc = readFileSync(new URL("../../../docs/ingest-api.md", import.meta.url), "utf8");
    const json = /```json\n([\s\S]*?)\n```/.exec(doc.replace(/\r\n/g, "\n"))?.[1];
    expect(json).toBeDefined();
    const batch = ingestBatchSchema.parse(JSON.parse(json!));
    for (const event of batch.events) {
      expect(parseIngestEvent(event)).toMatchObject({ ok: true });
    }
  });
});
