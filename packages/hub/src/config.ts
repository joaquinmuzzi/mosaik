/**
 * The hub's settings, read from environment variables (and `.env`, which `npm run dev` and
 * `npm start` load). Every one has a default, so the hub starts with no configuration at all.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { isValidTimeZone } from "@mosaik/shared";
import { z } from "zod";

export interface Config {
  /** Always 127.0.0.1: nothing leaves this computer. */
  host: "127.0.0.1";
  port: number;
  dbPath: string;
  gsmDbPath: string;
  ankiConnectUrl: string;
  /** Decks the Anki connector reads (subdecks included). */
  ankiDecks: string[];
  /** Of those, the premade decks with no immersion source: their cards count as `refold-1k`. */
  ankiRefoldDecks: string[];
  dayCutoffHour: number;
  timeZone: string;
  syncIntervalMinutes: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
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

/**
 * Where GameSentenceMiner keeps its database when GSM_DB_PATH is not set. GSM can be told to use
 * another folder (~/.config/GameSentenceMiner/data_dir.json); the GSM connector looks there too.
 */
export function defaultGsmDbPath(env: Env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const base = env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, "GameSentenceMiner", "gsm.db");
  }
  return join(homedir(), ".config", "GameSentenceMiner", "gsm.db");
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

const envSchema = z.object({
  HUB_PORT: optional(z.coerce.number().int().min(1).max(65_535)),
  HUB_DB_PATH: optional(z.string()),
  GSM_DB_PATH: optional(z.string()),
  ANKICONNECT_URL: optional(z.url({ protocol: /^https?$/ })),
  ANKI_DECKS: optional(deckList),
  ANKI_REFOLD_DECKS: optional(deckList),
  DAY_CUTOFF_HOUR: optional(z.coerce.number().int().min(0).max(23)),
  TZ_NAME: optional(z.string().refine(isValidTimeZone, { message: "unknown IANA time zone" })),
  // Up to a day
  SYNC_INTERVAL_MINUTES: optional(z.coerce.number().min(1).max(1440)),
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
  return {
    host: "127.0.0.1",
    port: values.HUB_PORT ?? 7300,
    dbPath: values.HUB_DB_PATH ?? defaultDbPath(env, platform),
    gsmDbPath: values.GSM_DB_PATH ?? defaultGsmDbPath(env, platform),
    ankiConnectUrl: values.ANKICONNECT_URL ?? "http://127.0.0.1:8765",
    ankiDecks: values.ANKI_DECKS ?? DEFAULT_ANKI_DECKS,
    ankiRefoldDecks: values.ANKI_REFOLD_DECKS ?? DEFAULT_ANKI_REFOLD_DECKS,
    dayCutoffHour: values.DAY_CUTOFF_HOUR ?? 4,
    timeZone: values.TZ_NAME ?? "America/Buenos_Aires",
    syncIntervalMinutes: values.SYNC_INTERVAL_MINUTES ?? 5,
    logLevel: values.LOG_LEVEL ?? "info",
  };
}
