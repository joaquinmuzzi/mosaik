import type { DaySummary } from "@mosaik/shared";
import { describe, expect, it } from "vitest";
import { periodKey, periodRows, weekdayRhythm } from "../src/lib/periods";

const day = (key: string, gsm: number, deuchan: number | null = null, extra: Partial<DaySummary> = {}) => ({
  day: key,
  gsmSeconds: gsm,
  deuchanSeconds: deuchan,
  reviews: 0,
  reviewSeconds: 0,
  cardsMined: 0,
  ...extra,
});

describe("periodKey", () => {
  it("names weeks by their Monday, months and years by their number", () => {
    expect(periodKey("2026-11-15", "week")).toBe("2026-11-09");
    expect(periodKey("2026-11-15", "month")).toBe("2026-11");
    expect(periodKey("2026-11-15", "year")).toBe("2026");
  });
});

describe("periodRows", () => {
  const days = [
    day("2026-10-30", 600, 0, { reviews: 10 }),
    day("2026-10-31", 0),
    day("2026-11-01", 1200, 300, { cardsMined: 2 }),
    day("2026-11-02", 0, null, { reviews: 5 }),
  ];

  it("adds each month up, newest first, with the change from the month before", () => {
    expect(periodRows(days, "month")).toEqual([
      {
        key: "2026-11",
        gsmSeconds: 1200,
        deuchanSeconds: 300,
        immersion: 1500,
        activeDays: 1,
        reviews: 5,
        cardsMined: 2,
        change: 900,
        current: true,
      },
      {
        key: "2026-10",
        gsmSeconds: 600,
        deuchanSeconds: 0,
        immersion: 600,
        activeDays: 1,
        reviews: 10,
        cardsMined: 0,
        change: null,
        current: false,
      },
    ]);
  });

  it("keeps only the newest periods, and computes the change before cutting", () => {
    const rows = periodRows(days, "week", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "2026-11-02", immersion: 0, change: -2100, current: true });
  });

  it("returns nothing without days", () => {
    expect(periodRows([], "year")).toEqual([]);
  });
});

describe("weekdayRhythm", () => {
  it("averages each weekday with its empty days, Monday first", () => {
    // Two Mondays (600 s and nothing) and a Sunday with game and video
    const rhythm = weekdayRhythm([day("2026-11-02", 600), day("2026-11-08", 100, 50), day("2026-11-09", 0)]);
    expect(rhythm).toHaveLength(7);
    expect(rhythm[0]).toEqual({
      weekday: 0,
      count: 2,
      averageGsm: 300,
      averageDeuchan: 0,
      average: 300,
      median: 300,
    });
    expect(rhythm[6]).toMatchObject({
      count: 1,
      averageGsm: 100,
      averageDeuchan: 50,
      average: 150,
      median: 150,
    });
    expect(rhythm[3]).toMatchObject({ count: 0, average: 0, median: 0 });
  });
});
