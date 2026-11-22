import { describe, expect, it } from "vitest";
import {
  activityFacts,
  activityLevel,
  addMonths,
  calendarColumns,
  calendarMonth,
  fitCalendar,
  monthsBetween,
} from "../src/lib/calendar";

describe("months", () => {
  it("add and subtract across years", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
    expect(monthsBetween("2025-12", "2026-11")).toBe(11);
  });

  it("have their weeks from Monday to Sunday, only with days of the month", () => {
    // 1 November 2026 is a Sunday
    const { weeks } = calendarMonth("2026-11");
    expect(weeks).toHaveLength(6);
    expect(weeks[0]!.map((cell) => cell?.day ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      "2026-11-01",
    ]);
    expect(weeks[1]![0]!.day).toBe("2026-11-02");
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.at(-1)![0]!.day).toBe("2026-11-30");
    expect(weeks.at(-1)![1]).toBeNull();
  });
});

describe("fitCalendar", () => {
  it("always fits the width", () => {
    for (let width = 220; width <= 1400; width += 20) {
      const { months, pitch } = fitCalendar("2026-11", width);
      expect(calendarColumns(months) * pitch).toBeLessThanOrEqual(width);
      expect(months.at(-1)!.month).toBe("2026-11");
    }
  });

  it("starts a short history at the left, with the months to come after it", () => {
    const { months } = fitCalendar("2026-11", 1200, { first: "2026-08" });
    expect([months[0]!.month, months.at(-1)!.month]).toEqual(["2026-08", "2027-07"]);
    const phone = fitCalendar("2026-11", 290, { first: "2026-01" });
    expect(phone.months.at(-1)!.month).toBe("2026-11");
  });

  it("shows a year where there is room, and fewer months where there is not", () => {
    expect(fitCalendar("2026-11", 1200).months).toHaveLength(12);
    const phone = fitCalendar("2026-11", 290);
    expect(phone.months.length).toBeLessThan(6);
    expect(phone.pitch).toBeGreaterThanOrEqual(12);
  });
});

describe("activityLevel", () => {
  it("goes from 0 to 10 against the average", () => {
    expect(activityLevel(0, 60)).toBe(0);
    expect(activityLevel(1, 60)).toBe(1);
    expect(activityLevel(60, 60)).toBe(5);
    expect(activityLevel(61, 60)).toBe(6);
    expect(activityLevel(600, 60)).toBe(10);
    expect(activityLevel(60, 0)).toBe(0);
  });
});

describe("activityFacts", () => {
  const days = (...values: number[]) =>
    values.map((seconds, index) => ({ day: `2026-11-${String(index + 1).padStart(2, "0")}`, seconds }));

  it("counts from the first day with something", () => {
    expect(activityFacts(days(0, 0, 100, 0, 100, 200))).toEqual({
      average: 100,
      activeAverage: 400 / 3,
      activeShare: 0.75,
      longest: 2,
      current: 2,
    });
  });

  it("keeps the current streak while today has nothing yet", () => {
    expect(activityFacts(days(1, 1, 1, 0)).current).toBe(3);
    expect(activityFacts(days(1, 1, 0, 0)).current).toBe(0);
  });

  it("is all zeros without activity", () => {
    expect(activityFacts(days(0, 0))).toMatchObject({ average: 0, activeShare: 0, longest: 0, current: 0 });
  });
});
