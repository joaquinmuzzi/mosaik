/**
 * Data every design shares, built only from the existing API: the recent-activity feed, per-title
 * series and weekly totals. The numbers are the API's; designs only present them.
 */
import type { ContentSummary, DaySummary, OriginStats } from "@mosaik/shared";
import { getContent, getDay } from "./api";
import { duration } from "./format";
import { hrefContent, hrefDay } from "./hrefs";

export const immersion = (day: DaySummary) => day.gsmSeconds + (day.deuchanSeconds ?? 0);

export interface FeedItem {
  key: string;
  day: string;
  /** Sort key: when it happened (a video only has its day). */
  ts: number;
  kind: "gsm" | "youtube" | "mined";
  title: string;
  detail: string;
  /** What it opens: the content, or the day for mined cards. */
  href: string;
}

/** What happened on the most recent active days, newest first. */
export async function loadFeed(days: DaySummary[], { maxDays = 6, maxItems = 10 } = {}): Promise<FeedItem[]> {
  const active = [...days]
    .reverse()
    .filter((day) => immersion(day) > 0 || day.cardsMined > 0)
    .slice(0, maxDays);
  const details = await Promise.all(active.map((day) => getDay(day.day)));
  const items: FeedItem[] = [];
  for (const detail of details) {
    const end = Date.parse(`${detail.day}T23:59:00Z`);
    for (const session of detail.gsm.sessions) {
      items.push({
        key: `gsm:${session.id}:${detail.day}`,
        day: detail.day,
        ts: session.end,
        kind: "gsm",
        title: session.title ?? "Juego",
        detail: `Leíste ${duration(session.seconds)}`,
        href: session.contentId ? hrefContent(session.contentId) : hrefDay(detail.day),
      });
    }
    for (const video of detail.deuchan.videos) {
      items.push({
        key: `${video.id}:${detail.day}`,
        day: detail.day,
        ts: detail.deuchan.snapshotAt ?? end,
        kind: "youtube",
        title: video.title || video.url || video.id,
        detail: `${video.contentKind === "reading" ? "Leíste" : "Miraste"} ${duration(video.seconds)}`,
        href: hrefContent(video.id),
      });
    }
    if (detail.anki.mined.length > 0) {
      const words = detail.anki.mined.map((card) => card.word ?? "?");
      items.push({
        key: `mined:${detail.day}`,
        day: detail.day,
        ts: Math.max(...detail.anki.mined.map((card) => card.created)),
        kind: "mined",
        title: `${words.length} ${words.length === 1 ? "tarjeta minada" : "tarjetas minadas"}`,
        detail: words.slice(0, 6).join(", ") + (words.length > 6 ? "…" : ""),
        href: hrefDay(detail.day),
      });
    }
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, maxItems);
}

export interface TitleSeries {
  id: string;
  title: string;
  kind: string;
  /** Seconds per day. */
  days: Map<string, number>;
}

/** Time per day of the contents with most time, for "by title" charts. */
export async function loadTitleSeries(contents: ContentSummary[], count = 5): Promise<TitleSeries[]> {
  const top = [...contents].sort((a, b) => b.seconds - a.seconds).slice(0, count);
  const details = await Promise.all(top.map((content) => getContent(content.id)));
  return details.map((detail) => ({
    id: detail.content.id,
    title: detail.content.title ?? detail.content.id,
    kind: detail.content.kind,
    days: new Map(detail.days.map((day) => [day.day, day.seconds])),
  }));
}

/** Monday of the week of `day`. */
export function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** Groups day keys into week keys, keeping order. */
export function weekKeys(days: string[]): string[] {
  return [...new Set(days.map(mondayOf))];
}

/** Adds values per week: `value(day)` for every day of `days`. */
export function perWeek(days: string[], value: (day: string) => number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const day of days) totals.set(mondayOf(day), (totals.get(mondayOf(day)) ?? 0) + value(day));
  return totals;
}

/** Retention as a fraction, or null without answers. */
export const rate = (retention: { reviews: number; passed: number }) =>
  retention.reviews > 0 ? retention.passed / retention.reviews : null;

/** Mined cards (everything but the premade deck), added up across origins. */
export function minedTotals(origins: OriginStats[]) {
  const mined = origins.filter((origin) => origin.origin !== "refold-1k");
  const sum = (pick: (origin: OriginStats) => number) =>
    mined.reduce((total, origin) => total + pick(origin), 0);
  return {
    cards: sum((origin) => origin.cards),
    mature: sum((origin) => origin.mature),
    young: { reviews: sum((o) => o.young.reviews), passed: sum((o) => o.young.passed) },
    matureRetention: {
      reviews: sum((o) => o.matureRetention.reviews),
      passed: sum((o) => o.matureRetention.passed),
    },
  };
}

/** Immersion milestones in hours (presentation only, see NOTES.milestones). */
export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 1500];
