/**
 * GameSentenceMiner's reading-time estimate, ported so that Mosaik's hours match GSM's.
 *
 * Source: GameSentenceMiner 2026.11.0 (`web/stats.py`, `calculate_actual_reading_time`, and
 * `util/stats/stats_util.py`). Lines are sorted by time and each gap between two lines is credited
 * to the earlier line:
 * - a gap longer than the session gap (30 minutes by default) ends the session and is not credited;
 * - a gap that spans a reading break the user marked is not credited (and does not end the session);
 * - within a session, the median reading speed (characters per second) is learned from the usable
 *   gaps, and each gap is credited at most 2.5 times what its line should take at that speed;
 * - the last line of a session gets nothing: nothing shows how long it was read.
 *
 * Characters are counted as GSM counts them for its statistics: without punctuation, symbols and
 * separators (spaces included), in Unicode code points.
 */

/** Fallback seconds per character before a session pace is available. */
export const MAX_SEC_PER_CHAR = 3.0;
/** Hard upper bound on any single line's time (5 minutes). */
export const ABSOLUTE_CEILING = 300.0;
/** Minimum characters for a line to teach the session pace. */
export const MIN_CHARS_FOR_SPEED = 5;
/** Subsecond text-delivery bursts are not reliable pace samples. */
export const MIN_GAP_FOR_SPEED = 1.0;
/** Minimum cap for a non-empty line. */
export const ADAPTIVE_FLOOR_SECONDS = 2.0;
/** Slack for difficult lines and brief lookups. */
export const ADAPTIVE_TOLERANCE = 2.5;
/** GSM's default `session_gap_seconds`. */
export const DEFAULT_SESSION_GAP_SECONDS = 1800;

export interface StatsTextOptions {
  /** GSM's `regex_out_repetitions`: three or more repeats count as three. */
  regexOutRepetitions?: boolean;
  /** What is removed before counting; see `punctuationRegex`. */
  punctuation?: RegExp;
}

const PUNCTUATION_PATTERN = "[\\p{P}\\p{S}\\p{Z}]";
const PUNCTUATION = new RegExp(PUNCTUATION_PATTERN, "gu");
// Without the dotAll flag, as in GSM: `.` does not match a line break
const REPETITIONS = /(.+?)\1{2,}/gu;

/**
 * GSM's `get_punctuation_regex`: Unicode punctuation, symbols and separators, plus the user's
 * `extra_punctuation_regex`. An extra pattern JavaScript cannot compile is ignored, as GSM ignores
 * one Python cannot.
 */
export function punctuationRegex(extra = ""): RegExp {
  const trimmed = extra.trim();
  if (trimmed === "") {
    return PUNCTUATION;
  }
  try {
    return new RegExp(`(?:${trimmed})|${PUNCTUATION_PATTERN}`, "gu");
  } catch {
    return PUNCTUATION;
  }
}

/** The text GSM counts: punctuation, symbols and separators removed (`clean_text_for_stats`). */
export function cleanTextForStats(text: string | null | undefined, options: StatsTextOptions = {}): string {
  if (text === null || text === undefined) {
    return "";
  }
  let cleaned = text.replace(options.punctuation ?? PUNCTUATION, "").trim();
  if (options.regexOutRepetitions) {
    cleaned = cleaned.replace(REPETITIONS, "$1$1$1");
  }
  return cleaned;
}

/** Characters as Python's `len` counts them: code points, not UTF-16 units. */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Characters per second, when a gap is usable for learning the pace (`reading_speed_sample`). */
export function readingSpeedSample(gapSeconds: number, chars: number): number | null {
  if (chars < MIN_CHARS_FOR_SPEED || !Number.isFinite(gapSeconds)) {
    return null;
  }
  if (gapSeconds < MIN_GAP_FOR_SPEED || gapSeconds > ABSOLUTE_CEILING) {
    return null;
  }
  return chars / gapSeconds;
}

/** Median characters per second of a session's usable gaps; 0 when there are none. */
export function sessionMedianCps(gaps: readonly Gap[]): number {
  const speeds: number[] = [];
  for (const { seconds, chars } of gaps) {
    const speed = readingSpeedSample(seconds, chars);
    if (speed !== null) speeds.push(speed);
  }
  return median(speeds);
}

/** The longest a line can plausibly take at the session's pace (`adaptive_cap_seconds`). */
export function adaptiveCapSeconds(chars: number, medianCps: number): number {
  if (chars <= 0) {
    return 0;
  }
  const cap =
    Number.isFinite(medianCps) && medianCps > 0
      ? Math.max(ADAPTIVE_FLOOR_SECONDS, (chars / medianCps) * ADAPTIVE_TOLERANCE)
      : Math.max(ADAPTIVE_FLOOR_SECONDS, chars * MAX_SEC_PER_CHAR);
  return Math.min(cap, ABSOLUTE_CEILING);
}

export interface Gap {
  /** Seconds until the next line. */
  seconds: number;
  /** Characters of the line being read during the gap. */
  chars: number;
}

/** Whether a gap spans a reading break; `breaks` must be sorted (`gap_crosses_reading_break`). */
export function gapCrossesBreak(start: number, end: number, breaks: readonly number[]): boolean {
  // The first break at or after `start` (bisect_left)
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (breaks[mid]! < start) low = mid + 1;
    else high = mid;
  }
  return low < breaks.length && breaks[low]! < end;
}

export interface ReadingLine {
  /** Epoch seconds, as GSM stores them. */
  timestamp: number;
  /** Characters of the cleaned text (see `cleanTextForStats`). */
  chars: number;
}

export interface ReadingOptions {
  sessionGapSeconds?: number;
  /** Reading breaks, epoch seconds. */
  breaks?: readonly number[];
}

export interface ReadingSession {
  /** Indexes into the sorted lines, inclusive. */
  first: number;
  last: number;
  seconds: number;
}

export interface ReadingTimeline<T extends ReadingLine> {
  /** The input lines, sorted by time (stable). */
  lines: T[];
  /** Seconds credited to each line, in the same order. */
  credits: number[];
  sessions: ReadingSession[];
  totalSeconds: number;
}

/**
 * Splits lines into sessions and credits each line with its reading time, exactly as GSM's
 * `calculate_actual_reading_time` adds it up.
 */
export function readingTimeline<T extends ReadingLine>(
  input: readonly T[],
  { sessionGapSeconds = DEFAULT_SESSION_GAP_SECONDS, breaks = [] }: ReadingOptions = {},
): ReadingTimeline<T> {
  const lines = input.filter((line) => Number.isFinite(line.timestamp));
  // Array.prototype.sort is stable, like Python's sorted
  lines.sort((a, b) => a.timestamp - b.timestamp);
  const sortedBreaks = [...breaks].sort((a, b) => a - b);
  const credits = lines.map(() => 0);
  const sessions: ReadingSession[] = [];
  let totalSeconds = 0;

  let first = 0;
  // The measured gaps of the current session, with the line each one belongs to
  let gaps: (Gap & { index: number })[] = [];

  const closeSession = (last: number) => {
    const medianCps = sessionMedianCps(gaps);
    let seconds = 0;
    for (const gap of gaps) {
      const credit = Math.min(gap.seconds, adaptiveCapSeconds(gap.chars, medianCps));
      credits[gap.index] = credit;
      seconds += credit;
    }
    sessions.push({ first, last, seconds });
    totalSeconds += seconds;
    gaps = [];
  };

  for (let index = 0; index < lines.length - 1; index += 1) {
    const start = lines[index]!.timestamp;
    const end = lines[index + 1]!.timestamp;
    const raw = end - start;
    if (raw > sessionGapSeconds) {
      closeSession(index);
      first = index + 1;
      continue;
    }
    if (gapCrossesBreak(start, end, sortedBreaks)) {
      continue;
    }
    gaps.push({ seconds: raw, chars: lines[index]!.chars, index });
  }
  if (lines.length > 0) {
    closeSession(lines.length - 1);
  }
  return { lines, credits, sessions, totalSeconds };
}

/** Total reading seconds, as `calculate_actual_reading_time` returns it (0 for fewer than 2 lines). */
export function actualReadingSeconds(lines: readonly ReadingLine[], options: ReadingOptions = {}): number {
  return lines.length < 2 ? 0 : readingTimeline(lines, options).totalSeconds;
}
