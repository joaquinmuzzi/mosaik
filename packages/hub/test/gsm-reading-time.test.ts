import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  actualReadingSeconds,
  adaptiveCapSeconds,
  cleanTextForStats,
  countCharacters,
  gapCrossesBreak,
  punctuationRegex,
  readingSpeedSample,
  readingTimeline,
  sessionMedianCps,
} from "../src/connectors/gsm/reading-time.ts";

/** Lines at the given seconds, each with `chars` characters. */
const at = (times: number[], chars = 10) => times.map((timestamp) => ({ timestamp, chars }));

describe("cleanTextForStats / countCharacters", () => {
  it("drops punctuation, symbols and every separator, spaces included, as GSM does", () => {
    expect(cleanTextForStats("Ich heiße Phoenix Wright.")).toBe("IchheißePhoenixWright");
    expect(cleanTextForStats("„Natürlich“, sagte sie – leise… 21:30 €")).toBe("Natürlichsagtesieleise2130");
    expect(cleanTextForStats(null)).toBe("");
  });

  it("removes the user's extra punctuation and limits repetitions when asked", () => {
    expect(cleanTextForStats("Hallo [Name]", { punctuation: punctuationRegex("\\[[^\\]]*\\]") })).toBe(
      "Hallo",
    );
    expect(cleanTextForStats("Neeeein", { regexOutRepetitions: true })).toBe("Neeein");
    // An extra pattern that does not compile is ignored, as in GSM
    expect(cleanTextForStats("a b", { punctuation: punctuationRegex("(") })).toBe("ab");
  });

  it("counts code points, like Python's len", () => {
    expect(countCharacters("Brücke")).toBe(6);
    expect(countCharacters("𝔸𝔹")).toBe(2);
  });
});

describe("the pieces of the algorithm", () => {
  it("learns the pace only from usable gaps", () => {
    expect(readingSpeedSample(10, 20)).toBe(2);
    expect(readingSpeedSample(10, 4)).toBeNull(); // too short a line
    expect(readingSpeedSample(0.5, 20)).toBeNull(); // a burst
    expect(readingSpeedSample(301, 20)).toBeNull(); // over the ceiling
    expect(sessionMedianCps([])).toBe(0);
    expect(
      sessionMedianCps([
        { seconds: 10, chars: 10 },
        { seconds: 5, chars: 10 },
        { seconds: 1, chars: 3 },
      ]),
    ).toBe(1.5);
  });

  it("caps a line at 2.5 times its expected time, between 2 s and 300 s", () => {
    expect(adaptiveCapSeconds(0, 1)).toBe(0);
    expect(adaptiveCapSeconds(10, 1)).toBe(25);
    expect(adaptiveCapSeconds(1, 10)).toBe(2);
    expect(adaptiveCapSeconds(1000, 1)).toBe(300);
    // No pace yet: 3 s per character
    expect(adaptiveCapSeconds(3, 0)).toBe(9);
  });

  it("finds a break inside a gap, start included and end excluded", () => {
    expect(gapCrossesBreak(10, 20, [15])).toBe(true);
    expect(gapCrossesBreak(10, 20, [10])).toBe(true);
    expect(gapCrossesBreak(10, 20, [20])).toBe(false);
    expect(gapCrossesBreak(10, 20, [5, 25])).toBe(false);
  });
});

describe("readingTimeline", () => {
  it("credits each gap to the line before it, and nothing to the last line", () => {
    const timeline = readingTimeline(at([0, 10, 20, 30]));
    expect(timeline.credits).toEqual([10, 10, 10, 0]);
    expect(timeline.sessions).toEqual([{ first: 0, last: 3, seconds: 30 }]);
  });

  it("caps a long look at the session's pace", () => {
    // Pace 1 char/s, so a 10-character line counts 25 s at most
    expect(readingTimeline(at([0, 10, 20, 220, 230])).credits).toEqual([10, 10, 25, 10, 0]);
  });

  it("starts a new session after the session gap, without crediting the gap", () => {
    const timeline = readingTimeline(at([0, 10, 1811, 1821]));
    expect(timeline.sessions.map((session) => [session.first, session.last, session.seconds])).toEqual([
      [0, 1, 10],
      [2, 3, 10],
    ]);
    expect(timeline.credits).toEqual([10, 0, 10, 0]);
  });

  it("follows a custom session gap", () => {
    expect(readingTimeline(at([0, 10, 620]), { sessionGapSeconds: 600 }).sessions).toHaveLength(2);
    expect(readingTimeline(at([0, 10, 620])).sessions).toHaveLength(1);
  });

  it("does not credit a gap that spans a reading break, nor learn from it", () => {
    const timeline = readingTimeline(at([0, 10, 20]), { breaks: [15] });
    expect(timeline.credits).toEqual([10, 0, 0]);
    expect(timeline.sessions).toHaveLength(1);
  });

  it("sorts the lines, keeps ties in order and ignores times that are not numbers", () => {
    const timeline = readingTimeline([
      { timestamp: 20, chars: 10, id: "c" },
      { timestamp: 0, chars: 10, id: "a" },
      { timestamp: Number.NaN, chars: 10, id: "x" },
      { timestamp: 10, chars: 10, id: "b1" },
      { timestamp: 10, chars: 10, id: "b2" },
    ]);
    expect(timeline.lines.map((line) => line.id)).toEqual(["a", "b1", "b2", "c"]);
  });

  it("gives nothing for fewer than two lines", () => {
    expect(actualReadingSeconds([])).toBe(0);
    expect(actualReadingSeconds(at([5]))).toBe(0);
  });
});

describe("parity with GameSentenceMiner", () => {
  it("computes exactly what GSM computes for the same lines", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("./fixtures/gsm/parity.json", import.meta.url), "utf8"),
    ) as {
      expected: { seconds: number; chars: number; sessions: number };
      sessionGapSeconds: number;
      breaks: number[];
      lines: [number, string][];
    };
    const lines = fixture.lines.map(([timestamp, text]) => ({
      timestamp,
      chars: countCharacters(cleanTextForStats(text)),
    }));
    const timeline = readingTimeline(lines, {
      sessionGapSeconds: fixture.sessionGapSeconds,
      breaks: fixture.breaks,
    });

    expect(lines.reduce((sum, line) => sum + line.chars, 0)).toBe(fixture.expected.chars);
    expect(timeline.sessions).toHaveLength(fixture.expected.sessions);
    // Python adds floats with compensated summation; the difference is far below a microsecond
    expect(timeline.totalSeconds).toBeCloseTo(fixture.expected.seconds, 6);
    expect(timeline.credits.reduce((sum, credit) => sum + credit, 0)).toBeCloseTo(
      fixture.expected.seconds,
      6,
    );
  });
});
