/** Responses of the hub's read API, used by the dashboard. */

export interface HealthResponse {
  status: "ok";
  /** Always "mosaik", so a client can tell the hub apart from another server on the same port. */
  name: "mosaik";
  version: string;
  /** The newest database migration applied. */
  schemaVersion: number;
  /** Server time, UTC milliseconds. */
  now: number;
}

export interface SourceStatus {
  source: string;
  /** Whether a connector for this source is registered in the running hub. */
  registered: boolean;
  running: boolean;
  lastRunAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  /** What the last successful run did, as the connector reported it (counts, etc.). */
  lastSummary: Record<string, unknown> | null;
}

export interface SourcesResponse {
  sources: SourceStatus[];
}

export type SyncOutcome =
  | { source: string; ok: true; summary: Record<string, unknown> | null }
  | { source: string; ok: false; error: string };

export interface ApiError {
  error: string;
  message?: string;
}

// Dashboard reads (phase 4). Times in seconds; days as YYYY-MM-DD.

/**
 * One day. GSM and Anki use Mosaik's day (the user's time zone, starting at the cutoff hour);
 * Deuchan's total uses Deuchan's own day, which starts at midnight.
 */
export interface DaySummary {
  day: string;
  /** Reading time in GSM, in the target language. */
  gsmSeconds: number;
  /** What Deuchan's dashboard shows for that day, or null if Deuchan sent nothing for it. */
  deuchanSeconds: number | null;
  /** Anki reviews (learning, review, relearning, filtered), as Anki counts them. */
  reviews: number;
  reviewSeconds: number;
  /** Notes created that day outside the premade decks. */
  cardsMined: number;
}

export interface OverviewResponse {
  today: string;
  /** The hour a day starts at, and the time zone, so the dashboard can say so. */
  cutoffHour: number;
  timeZone: string;
  /** Oldest first, ending today, one entry per day (empty days included). */
  days: DaySummary[];
  /** Days in a row, up to today (or yesterday if today has nothing yet), with any immersion. */
  streak: number;
}

export interface DayGsmSession {
  id: string;
  title: string | null;
  start: number;
  end: number;
  seconds: number;
  characters: number | null;
  lines: number | null;
}

export interface DayVideo {
  videoId: string;
  title: string | null;
  /** Seconds Deuchan credited to the video that day (this computer only). */
  seconds: number;
}

export interface DayMinedCard {
  noteId: number;
  word: string | null;
  origin: string;
  contentTitle: string | null;
  sourceTitle: string | null;
  created: number;
}

export interface DayDetailResponse {
  day: string;
  cutoffHour: number;
  timeZone: string;
  gsm: { seconds: number; sessions: DayGsmSession[]; otherLanguageSeconds: number };
  deuchan: { seconds: number | null; snapshotAt: number | null; videos: DayVideo[] };
  anki: {
    reviews: number;
    byType: { learning: number; review: number; relearning: number; filtered: number };
    seconds: number;
    /** Cards seen for the first time that day. */
    newCards: number;
    mined: DayMinedCard[];
  };
}

export interface OriginRetention {
  /** Answers on review cards (type 1) and how many were not "Again". */
  reviews: number;
  passed: number;
}

export interface OriginStats {
  origin: string;
  cards: number;
  /** Cards whose current interval is 21 days or more. */
  mature: number;
  young: OriginRetention;
  matureRetention: OriginRetention;
}

export interface WeekPoint {
  /** Monday of the week. */
  week: string;
  gsmSeconds: number;
  deuchanSeconds: number;
  /** Cards that reached a 21-day interval for the first time that week, cumulative. */
  maturedMined: number;
  maturedRefold: number;
}

export interface AnkiStatsResponse {
  origins: OriginStats[];
  weeks: WeekPoint[];
}
