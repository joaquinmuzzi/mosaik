/**
 * Checks the Anki connector against the real Anki (which must be open): syncs once, then compares
 * Mosaik's reviews per day with Anki's own statistics (`getNumCardsReviewedByDay`).
 *
 *   npm run verify:anki              sync into the configured database, then compare
 *   npm run verify:anki -- --no-sync compare what is already in the database
 *
 * Anki counts the whole collection, so reviews of decks Mosaik does not read, or of cards deleted
 * since, make Anki's number larger. Mosaik's number should never be the larger one.
 */
import { loadConfig } from "../config.ts";
import { createAnkiClient } from "../connectors/anki/client.ts";
import { ANKI_SOURCE, createAnkiConnector } from "../connectors/anki/connector.ts";
import { openDatabase } from "../db/database.ts";
import { applyMigrations } from "../db/migrate.ts";
import { compareReviewsPerDay, reviewsPerDay } from "../metrics/reviews.ts";
import { createScheduler } from "../scheduler.ts";

async function main(): Promise<number> {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  applyMigrations(db);
  const client = createAnkiClient({ url: config.ankiConnectUrl });
  console.log(`Database: ${config.dbPath}`);
  console.log(`Decks: ${config.ankiDecks.join(", ")}`);

  if (!process.argv.includes("--no-sync")) {
    const scheduler = createScheduler({
      db,
      intervalMs: 60_000,
      log: { info() {}, warn: (_object, message) => console.warn(`warning: ${message}`), error() {} },
    });
    scheduler.register(
      createAnkiConnector({
        db,
        client,
        decks: config.ankiDecks,
        refoldDecks: config.ankiRefoldDecks,
        timeZone: config.timeZone,
      }),
    );
    const outcome = await scheduler.run(ANKI_SOURCE);
    if (!outcome.ok) {
      console.error(`Sync failed: ${outcome.error}`);
      return 1;
    }
    console.log("Sync:", JSON.stringify(outcome.summary));
  }

  const mosaik = reviewsPerDay(db, config.timeZone, config.dayCutoffHour);
  const anki = await client.getNumCardsReviewedByDay();
  const differences = compareReviewsPerDay(mosaik, anki);
  db.close();
  const days = new Set([...mosaik.keys(), ...anki.map(([day]) => day)]).size;
  const total = [...mosaik.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `\n${days} days, ${total} reviews in Mosaik (cutoff ${config.dayCutoffHour}:00, ${config.timeZone})`,
  );

  if (differences.length === 0) {
    console.log("Every day matches Anki.");
    return 0;
  }
  console.log(`${differences.length} days differ:`);
  for (const { day, mosaik: ours, anki: theirs } of differences) {
    const note = ours < theirs ? "Anki also counts other decks and deleted cards" : "MOSAIK COUNTS MORE";
    console.log(`  ${day}  Mosaik ${String(ours).padStart(4)}  Anki ${String(theirs).padStart(4)}  ${note}`);
  }
  return differences.some((row) => row.mosaik > row.anki) ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
