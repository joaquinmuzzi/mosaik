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
  /** The computer this state is of: `principal` is the hub's own, others are agents (server mode). */
  device: string;
  /** How the device is shown: its label, or its name. */
  deviceLabel: string;
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
  /** The content: `yt:<videoId>` for YouTube, `web:<hash>` for anything else. */
  id: string;
  /** Only for YouTube. */
  videoId: string | null;
  title: string | null;
  url: string | null;
  /** "reading" for time counted by hand (comics, for example). */
  contentKind: "video" | "reading";
  /** Seconds Deuchan credited to it that day, on all devices. */
  seconds: number;
  /** The devices it was watched or read on, most seconds first, as they are shown (labels). */
  devices: string[];
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
  deuchan: {
    /** The sum of the devices, or null if Deuchan sent nothing for that day. */
    seconds: number | null;
    /** The part of `seconds` counted by hand as reading. */
    readingSeconds: number;
    /** Each device's own total for the day. */
    devices: { device: string; label: string; seconds: number; at: number }[];
    /** The newest snapshot of any device. */
    snapshotAt: number | null;
    videos: DayVideo[];
  };
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

// Contents and sentence search (phase 5).

export interface ContentSummary {
  id: string;
  source: string;
  kind: string;
  title: string | null;
  /** Active time: GSM's reading time in the target language, or what Deuchan credited the video. */
  seconds: number;
  sessions: number;
  /** Characters read, as GSM counts them (GSM only). */
  characters: number | null;
  cardsMined: number;
  firstDay: string | null;
  lastDay: string | null;
  /** URL of the cover image (stored, or a YouTube thumbnail if turned on), or null. */
  cover: string | null;
  /** Where the stored cover came from; null when there is none yet. */
  coverSource: CoverSource | null;
}

/** GSM's game image, a YouTube thumbnail, an image the user uploaded, or one they picked on Steam. */
/** `manual` and `steam` were chosen by the user; `web` and `steam-auto` were found by Mosaik. */
export type CoverSource = "gsm" | "youtube" | "manual" | "steam" | "web" | "steam-auto";

/** A game found on Steam, offered as a cover. */
export interface SteamCandidate {
  appId: number;
  name: string;
  /** Portrait cover (600×900); some games only have `header`. */
  image: string;
  header: string;
}

export interface ContentsResponse {
  contents: ContentSummary[];
}

export interface ContentSession {
  id: string;
  language: string;
  start: number;
  end: number;
  seconds: number;
  characters: number | null;
  lines: number | null;
}

export interface ContentLine {
  id: string;
  ts: number;
  text: string;
  /** Words of the cards mined from this line. */
  mined: string[];
}

export interface ContentCard {
  noteId: number;
  word: string | null;
  created: number;
  /** The sentence it was mined from, when the source knows it (GSM). */
  line: string | null;
}

export interface ContentDetailResponse {
  content: ContentSummary & {
    externalId: string | null;
    url: string | null;
    totalUnits: number | null;
    unit: string | null;
  };
  /** Characters per hour, only for reading (GSM), as GSM counts characters. */
  charactersPerHour: number | null;
  /** Share of the content read, only when the source knows its length. */
  completion: number | null;
  days: { day: string; seconds: number }[];
  sessions: ContentSession[];
  cards: ContentCard[];
  /** The newest lines read (up to 200). */
  lines: ContentLine[];
}

export interface SearchHit {
  id: string;
  ts: number;
  text: string;
  contentId: string | null;
  contentTitle: string | null;
  /** The Mosaik day the line was read on. */
  day: string;
  mined: string[];
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  /** True when there were more hits than returned. */
  more: boolean;
}

// Statistics over the whole history.

/** The content that leads one highlight, and by how much (seconds, sessions, characters or cards). */
export interface HighlightContent {
  id: string;
  title: string | null;
  kind: string;
  value: number;
}

/** Days in a row, first and last day included. */
export interface StreakRecord {
  days: number;
  from: string;
  to: string;
}

export interface Highlights {
  mostTime: HighlightContent | null;
  mostSessions: HighlightContent | null;
  /** GSM only: Deuchan does not count characters. */
  mostCharacters: HighlightContent | null;
  mostMined: HighlightContent | null;
  /** The day with most immersion (GSM + Deuchan). */
  biggestDay: { day: string; seconds: number } | null;
  /** The longest run of days with any immersion. */
  longestStreak: StreakRecord | null;
  /** The longest run of days with the same content. */
  longestTitleStreak: (StreakRecord & { id: string; title: string | null; kind: string }) | null;
}

export interface StatsResponse {
  today: string;
  cutoffHour: number;
  timeZone: string;
  /** From the first day with anything (immersion, reviews or mined cards) to today, oldest first. */
  days: DaySummary[];
  highlights: Highlights;
}

// Server mode: login and devices.

export interface AuthStatusResponse {
  mode: "local" | "server";
  /** Always true in local mode, which has no login. */
  authenticated: boolean;
  /** Server mode with no account yet: the setup token creates it. */
  setupNeeded: boolean;
  username: string | null;
}

export interface DeviceInfo {
  /** The key of its data: it never changes. */
  name: string;
  /** How it is shown ('PC1'), or null to show its name. Devices of one computer can share it. */
  label: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface DevicesResponse {
  devices: DeviceInfo[];
}

/** The token is shown this once: the server only keeps its hash. */
export interface CreateDeviceResponse {
  name: string;
  token: string;
}
