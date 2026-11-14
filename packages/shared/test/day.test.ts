import { describe, expect, it } from "vitest";
import { dayKey, isValidTimeZone } from "../src/day.ts";

const BA = "America/Buenos_Aires"; // UTC-3, no daylight saving time

describe("dayKey", () => {
  it("uses the local date of the time zone, not the UTC one", () => {
    // 2026-11-15 01:30 UTC is 2026-11-14 22:30 in Buenos Aires
    expect(dayKey(Date.UTC(2026, 10, 15, 1, 30), BA, 0)).toBe("2026-11-14");
  });

  it("keeps the hours before the cutoff in the previous day", () => {
    // 03:59 local (06:59 UTC) still belongs to the 14th with a 4:00 cutoff
    expect(dayKey(Date.UTC(2026, 10, 15, 6, 59), BA, 4)).toBe("2026-11-14");
    // 04:00 local starts the 15th
    expect(dayKey(Date.UTC(2026, 10, 15, 7, 0), BA, 4)).toBe("2026-11-15");
  });

  it("behaves like plain local dates with a cutoff of 0", () => {
    expect(dayKey(Date.UTC(2026, 10, 15, 3, 0), BA, 0)).toBe("2026-11-15");
    expect(dayKey(Date.UTC(2026, 10, 15, 2, 59), BA, 0)).toBe("2026-11-14");
  });

  it("rejects a cutoff outside 0-23", () => {
    expect(() => dayKey(0, BA, 24)).toThrow(RangeError);
    expect(() => dayKey(0, BA, 1.5)).toThrow(RangeError);
  });
});

describe("isValidTimeZone", () => {
  it("knows IANA zones and rejects anything else", () => {
    expect(isValidTimeZone(BA)).toBe(true);
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
