/**
 * The "day" of a moment, as the person lives it: in their time zone, and starting at a cutoff hour
 * instead of midnight (Anki starts its days at 4:00), so that a session that goes past midnight
 * still belongs to the evening it started in.
 *
 * Timestamps are always stored in UTC milliseconds; only this function turns them into days.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // en-CA formats dates as YYYY-MM-DD
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether `timeZone` is an IANA zone this runtime knows, such as `America/Buenos_Aires`. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The day of `timestampMs` as `YYYY-MM-DD`.
 *
 * The cutoff is applied by moving the moment back `cutoffHour` hours before reading the local date.
 * On the night a zone changes its clocks this is off by the size of the change, for at most an hour;
 * Buenos Aires has no daylight saving time.
 */
export function dayKey(timestampMs: number, timeZone: string, cutoffHour: number): string {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new RangeError(`cutoffHour must be an integer from 0 to 23, got ${cutoffHour}`);
  }
  return formatterFor(timeZone).format(new Date(timestampMs - cutoffHour * 3_600_000));
}
