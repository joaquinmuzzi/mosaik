/** The connectors the hub runs, built from the configuration. One per source, added phase by phase. */
import type { Config } from "../config.ts";
import type { Database } from "../db/database.ts";
import { createAnkiClient } from "./anki/client.ts";
import { createAnkiConnector } from "./anki/connector.ts";
import type { Connector } from "./types.ts";

export function createConnectors(db: Database, config: Config): Connector[] {
  return [
    createAnkiConnector({
      db,
      client: createAnkiClient({ url: config.ankiConnectUrl }),
      decks: config.ankiDecks,
      refoldDecks: config.ankiRefoldDecks,
    }),
  ];
}
