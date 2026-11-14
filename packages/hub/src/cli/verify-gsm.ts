/**
 * Checks the GSM connector against the user's real gsm.db (opened read-only): syncs once, then
 * compares with GSM's own daily rollup (`game_daily_rollup`, one row per day and game).
 *
 *   npm run verify:gsm              sync into the configured database, then compare
 *   npm run verify:gsm -- --no-sync compare what is already in the database
 *
 * Two numbers are compared with each rollup row:
 * - "port": GSM's procedure (each day and game computed on its own) run on Mosaik's copy. It should
 *   match exactly: it proves the algorithm and the copy are right.
 * - "Mosaik": the time Mosaik credits to each line, added up by GSM's day (midnight). Sessions are not
 *   cut at midnight in Mosaik, so a session that crosses it can differ slightly. It must stay within 5 %.
 *
 * GSM rolls up days only up to yesterday, so today appears with Mosaik's numbers alone.
 */
import { loadConfig } from "../config.ts";
import { createGsmConnector } from "../connectors/gsm/connector.ts";
import { punctuationRegex } from "../connectors/gsm/reading-time.ts";
import { locateGsm, openGsmReadOnly, readGsmStatsSettings } from "../connectors/gsm/source.ts";
import { openDatabase } from "../db/database.ts";
import { applyMigrations } from "../db/migrate.ts";
import { gsmDailyRollup, readingSecondsPerDay } from "../metrics/reading.ts";
import { createScheduler } from "../scheduler.ts";

const TOLERANCE_PERCENT = 5;

const minutes = (seconds: number) => `${(seconds / 60).toFixed(1).padStart(6)} min`;
const percent = (ours: number, theirs: number) =>
  theirs === 0 ? (ours === 0 ? 0 : Infinity) : ((ours - theirs) / theirs) * 100;

async function main(): Promise<number> {
  const config = loadConfig();
  const location = locateGsm(config.gsmDbPath);
  const db = openDatabase(config.dbPath);
  applyMigrations(db);
  console.log(`Database: ${config.dbPath}`);
  console.log(`GSM: ${location.dbPath}`);

  if (!process.argv.includes("--no-sync")) {
    const scheduler = createScheduler({
      db,
      intervalMs: 60_000,
      log: { info() {}, warn: (_object, message) => console.warn(`warning: ${message}`), error() {} },
    });
    scheduler.register(
      createGsmConnector({
        db,
        locate: () => location,
        attribution: { refoldDecks: config.ankiRefoldDecks, timeZone: config.timeZone },
        timeZone: config.timeZone,
      }),
    );
    const outcome = await scheduler.run("gsm");
    if (!outcome.ok) {
      console.error(`Sync failed: ${outcome.error}`);
      return 1;
    }
    console.log("Sync:", JSON.stringify(outcome.summary));
  }

  const settings = readGsmStatsSettings(location.dataDir);
  const port = gsmDailyRollup(db, {
    timeZone: config.timeZone,
    sessionGapSeconds: settings.sessionGapSeconds,
    text: {
      punctuation: punctuationRegex(settings.extraPunctuationRegex),
      regexOutRepetitions: settings.regexOutRepetitions,
    },
  });
  const mosaik = readingSecondsPerDay(db, { timeZone: config.timeZone, cutoffHour: 0 });
  const titles = new Map(
    (
      db.prepare("SELECT id, title FROM contents WHERE source = 'gsm'").all() as {
        id: string;
        title: string | null;
      }[]
    ).map((row) => [row.id, row.title ?? row.id]),
  );

  const gsm = openGsmReadOnly(location.dbPath);
  const rollup = gsm
    .prepare(
      "SELECT date, game_id, total_characters, total_reading_time_seconds FROM game_daily_rollup ORDER BY date",
    )
    .all() as {
    date: string;
    game_id: string;
    total_characters: string;
    total_reading_time_seconds: string;
  }[];
  gsm.close();

  let failures = 0;
  const seen = new Set<string>();
  console.log(`\nAgainst GSM's daily rollup (days start at midnight, ${config.timeZone}):`);
  for (const row of rollup) {
    const key = `${row.date}|${row.game_id}`;
    seen.add(key);
    const theirs = Number(row.total_reading_time_seconds);
    const ours = port.get(key);
    const credited = mosaik.get(`${row.date}|gsm:${row.game_id}`) ?? 0;
    const portDiff = percent(ours?.seconds ?? 0, theirs);
    const mosaikDiff = percent(credited, theirs);
    if (Math.abs(mosaikDiff) > TOLERANCE_PERCENT) failures += 1;
    console.log(
      `  ${row.date}  ${(titles.get(`gsm:${row.game_id}`) ?? row.game_id).slice(0, 40).padEnd(40)}  ` +
        `GSM ${minutes(theirs)}  port ${minutes(ours?.seconds ?? 0)} (${portDiff.toFixed(4)} %)  ` +
        `Mosaik ${minutes(credited)} (${mosaikDiff.toFixed(2)} %)  ` +
        `chars ${ours?.chars ?? 0}/${row.total_characters}`,
    );
  }

  const pending = [...port.entries()].filter(([key]) => !seen.has(key));
  if (pending.length > 0) {
    console.log("\nNot rolled up by GSM yet:");
    for (const [key, total] of pending) {
      const [day, gameId] = key.split("|") as [string, string];
      const credited = mosaik.get(`${day}|gsm:${gameId}`) ?? 0;
      console.log(
        `  ${day}  ${(titles.get(`gsm:${gameId}`) ?? gameId).slice(0, 40).padEnd(40)}  ` +
          `port ${minutes(total.seconds)}  Mosaik ${minutes(credited)}`,
      );
    }
  }
  db.close();

  if (failures > 0) {
    console.log(`\n${failures} row(s) differ by more than ${TOLERANCE_PERCENT} %.`);
    return 1;
  }
  console.log(`\nEvery rolled-up day is within ${TOLERANCE_PERCENT} %.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
