/** Numbers, times and dates in Spanish. */

export const number = new Intl.NumberFormat("es-AR");
export const percent = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

/** `4368` → `1 h 13 min`; under a minute, `38 s`. */
export function duration(seconds: number): string {
  if (seconds > 0 && seconds < 60) return `${Math.round(seconds)} s`;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

/** Minutes with one decimal, for chart axes. */
export const minutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;

const longDate = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });

/** `2026-11-14` → `sábado, 14 de noviembre de 2026`. */
export const dayLong = (day: string) => longDate.format(new Date(`${day}T12:00:00Z`));
/** `2026-11-14` → `14 nov`. */
export const dayShort = (day: string) => shortDate.format(new Date(`${day}T12:00:00Z`));

/**
 * A moment as 24-hour `hh:mm` in the user's zone. With `day`, a moment on another calendar day (after
 * midnight, before the cutoff) says which: `00:02 (sáb 14)`.
 */
export function timeOf(ms: number, timeZone: string, day?: string): string {
  const time = new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(ms);
  if (!day) return time;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone }).format(ms);
  if (date === day) return time;
  const label = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", timeZone }).format(ms);
  return `${time} (${label.replace(".", "")})`;
}

/** `2026-11-14` plus `n` days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The words for each card origin. */
export const ORIGIN_LABELS: Record<string, string> = {
  gsm: "Juegos (GSM)",
  youtube: "YouTube",
  "refold-1k": "Refold 1k",
  unknown: "Sin origen",
};
