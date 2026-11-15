/**
 * The hub's settings, read from environment variables (and `.env`, which `npm run dev` and
 * `npm start` load). Every one has a default, so the hub starts with no configuration at all.
 *
 * `MOSAIK_MODE` picks how it runs: `local` (the default) listens on 127.0.0.1 only, reads Anki and GSM
 * itself and has no login; `server` is for a server on the internet (Railway): it listens on all
 * interfaces, reads no sources (agents send them), and asks for a login; `agent` runs on each computer
 * where immersion happens: it reads Anki and GSM and sends them to the server at SERVER_URL, with the
 * device token DEVICE_TOKEN; it has no database and no dashboard.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isValidTimeZone } from "@mosaik/shared";
import { z } from "zod";

export type Mode = "local" | "server" | "agent";

export interface Config {
  mode: Mode;
  /** 127.0.0.1 in local mode, so nothing leaves this computer; all interfaces in server mode. */
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  /** Server mode: the address people open (`https://mosaik.example.app`); only that host is answered. */
  publicUrl: string | null;
  /** Server mode: the one-time secret that creates the account. */
  setupToken: string | null;
  /** Agent mode: the server it sends to. */
  serverUrl: string | null;
  /** Agent mode: this computer's token, created in the server's Fuentes → Dispositivos. */
  deviceToken: string | null;
  /** Agent mode: where batches wait while the server cannot be reached. */
  outboxDir: string;
  dbPath: string;
  /** GSM_DB_PATH, or `null` to find GameSentenceMiner's database where GSM keeps it. */
  gsmDbPath: string | null;
  ankiConnectUrl: string;
  /** Decks the Anki connector reads (subdecks included). */
  ankiDecks: string[];
  /** Of those, the premade decks with no immersion source: their cards count as `refold-1k`. */
  ankiRefoldDecks: string[];
  dayCutoffHour: number;
  timeZone: string;
  syncIntervalMinutes: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  /** The language being learned: only its sessions count as immersion. */
  targetLanguage: string;
  /** Fetch YouTube thumbnails from YouTube (off by default: it tells YouTube which videos you watched). */
  youtubeThumbnails: boolean;
}

type Env = Record<string, string | undefined>;

/** Where Mosaik keeps its own database when HUB_DB_PATH is not set. */
export function defaultDbPath(env: Env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "Mosaik", "mosaik.db");
  }
  const base = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "mosaik", "mosaik.db");
}

const DEFAULT_ANKI_DECKS = ["German Mining", "Refold Alemán-mil"];
const DEFAULT_ANKI_REFOLD_DECKS = ["Refold Alemán-mil"];

/** A comma-separated list, such as `German Mining, Refold Alemán-mil`. */
const deckList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((deck) => deck.trim())
      .filter((deck) => deck.length > 0),
  )
  .refine((decks) => decks.length > 0, { message: "must name at least one deck" });

/** An empty variable counts as unset, as in a `.env` line like `GSM_DB_PATH=`. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const port = z.coerce.number().int().min(1).max(65_535);

const envSchema = z.object({
  MOSAIK_MODE: optional(z.enum(["local", "server", "agent"])),
  HUB_PORT: optional(port),
  // Set by Railway and most hosts; used in server mode only
  PORT: optional(port),
  PUBLIC_URL: optional(z.url({ protocol: /^https?$/ })),
  SETUP_TOKEN: optional(z.string().min(16, "must be at least 16 characters")),
  SERVER_URL: optional(z.url({ protocol: /^https?$/ })),
  DEVICE_TOKEN: optional(z.string().regex(/^mkd_[\w-]{20,}$/, "must be a device token (mkd_…)")),
  AGENT_OUTBOX: optional(z.string()),
  HUB_DB_PATH: optional(z.string()),
  GSM_DB_PATH: optional(z.string()),
  ANKICONNECT_URL: optional(z.url({ protocol: /^https?$/ })),
  ANKI_DECKS: optional(deckList),
  ANKI_REFOLD_DECKS: optional(deckList),
  DAY_CUTOFF_HOUR: optional(z.coerce.number().int().min(0).max(23)),
  TZ_NAME: optional(z.string().refine(isValidTimeZone, { message: "unknown IANA time zone" })),
  // Up to a day
  SYNC_INTERVAL_MINUTES: optional(z.coerce.number().min(1).max(1440)),
  YOUTUBE_THUMBNAILS: optional(z.enum(["0", "1", "true", "false"])),
  TARGET_LANGUAGE: optional(z.string().regex(/^[a-z]{2,3}$/)),
  LOG_LEVEL: optional(z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])),
});

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadConfig(env: Env = process.env, platform: NodeJS.Platform = process.platform): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  const values = parsed.data;
  const mode = values.MOSAIK_MODE ?? "local";
  const dbPath = values.HUB_DB_PATH ?? defaultDbPath(env, platform);
  const problem = (text: string) => new ConfigError(`Invalid configuration:\n  ${text}`);
  /** Plain http only to this computer: everything else must be https. */
  const local = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";
  let serverUrl: string | null = null;
  if (mode === "agent") {
    if (!values.SERVER_URL) throw problem("SERVER_URL: required in agent mode");
    if (!values.DEVICE_TOKEN) throw problem("DEVICE_TOKEN: required in agent mode");
    const url = new URL(values.SERVER_URL);
    if (url.protocol !== "https:" && !local(url)) throw problem("SERVER_URL: must be https:// in agent mode");
    serverUrl = url.origin;
  }
  let publicUrl: string | null = null;
  if (mode === "server") {
    if (!values.PUBLIC_URL) {
      throw new ConfigError("Invalid configuration:\n  PUBLIC_URL: required in server mode");
    }
    const url = new URL(values.PUBLIC_URL);
    // The session cookie is Secure: plain http is only fine for trying the server mode on this computer
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) {
      throw new ConfigError("Invalid configuration:\n  PUBLIC_URL: must be https:// in server mode");
    }
    publicUrl = url.origin;
  }
  return {
    mode,
    host: mode === "server" ? "0.0.0.0" : "127.0.0.1",
    port: (mode === "server" ? values.PORT : undefined) ?? values.HUB_PORT ?? 7300,
    publicUrl,
    setupToken: mode === "server" ? (values.SETUP_TOKEN ?? null) : null,
    serverUrl,
    deviceToken: mode === "agent" ? (values.DEVICE_TOKEN ?? null) : null,
    dbPath,
    outboxDir: values.AGENT_OUTBOX ?? join(dirname(dbPath), "outbox"),
    gsmDbPath: values.GSM_DB_PATH ?? null,
    ankiConnectUrl: values.ANKICONNECT_URL ?? "http://127.0.0.1:8765",
    ankiDecks: values.ANKI_DECKS ?? DEFAULT_ANKI_DECKS,
    ankiRefoldDecks: values.ANKI_REFOLD_DECKS ?? DEFAULT_ANKI_REFOLD_DECKS,
    dayCutoffHour: values.DAY_CUTOFF_HOUR ?? 4,
    timeZone: values.TZ_NAME ?? "America/Buenos_Aires",
    syncIntervalMinutes: values.SYNC_INTERVAL_MINUTES ?? 5,
    logLevel: values.LOG_LEVEL ?? "info",
    targetLanguage: values.TARGET_LANGUAGE ?? "de",
    youtubeThumbnails: values.YOUTUBE_THUMBNAILS === "1" || values.YOUTUBE_THUMBNAILS === "true",
  };
}
