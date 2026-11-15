import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("has a default for everything, listening on 127.0.0.1", () => {
    const config = loadConfig({ LOCALAPPDATA: "C:\\Local", APPDATA: "C:\\Roaming" }, "win32");
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 7300,
      dbPath: join("C:\\Local", "Mosaik", "mosaik.db"),
      gsmDbPath: null,
      ankiConnectUrl: "http://127.0.0.1:8765",
      ankiDecks: ["German Mining", "Refold Alemán-mil"],
      ankiRefoldDecks: ["Refold Alemán-mil"],
      dayCutoffHour: 4,
      timeZone: "America/Buenos_Aires",
      syncIntervalMinutes: 5,
      logLevel: "info",
      targetLanguage: "de",
      youtubeThumbnails: false,
    });
  });

  it("reads every variable", () => {
    const config = loadConfig({
      HUB_PORT: "7400",
      HUB_DB_PATH: "/data/mosaik.db",
      GSM_DB_PATH: "/data/gsm.db",
      ANKICONNECT_URL: "http://127.0.0.1:9999",
      DAY_CUTOFF_HOUR: "0",
      TZ_NAME: "Europe/Berlin",
      SYNC_INTERVAL_MINUTES: "15",
      LOG_LEVEL: "debug",
    });
    expect(config).toMatchObject({
      port: 7400,
      dbPath: "/data/mosaik.db",
      gsmDbPath: "/data/gsm.db",
      ankiConnectUrl: "http://127.0.0.1:9999",
      dayCutoffHour: 0,
      timeZone: "Europe/Berlin",
      syncIntervalMinutes: 15,
      logLevel: "debug",
    });
  });

  it("reads the deck lists, trimming each name", () => {
    const config = loadConfig({ ANKI_DECKS: " Mining , Core::Sub ,", ANKI_REFOLD_DECKS: "Core" });
    expect(config.ankiDecks).toEqual(["Mining", "Core::Sub"]);
    expect(config.ankiRefoldDecks).toEqual(["Core"]);
    expect(() => loadConfig({ ANKI_DECKS: " , " })).toThrow(/ANKI_DECKS/);
  });

  it("treats empty variables as unset", () => {
    expect(loadConfig({ HUB_PORT: "", GSM_DB_PATH: "" }, "linux").port).toBe(7300);
  });

  it("explains what is wrong", () => {
    expect(() => loadConfig({ HUB_PORT: "seventy", TZ_NAME: "Nowhere/Land" })).toThrow(ConfigError);
    expect(() => loadConfig({ DAY_CUTOFF_HOUR: "24" })).toThrow(/DAY_CUTOFF_HOUR/);
    expect(() => loadConfig({ TZ_NAME: "Nowhere/Land" })).toThrow(/TZ_NAME/);
    expect(() => loadConfig({ ANKICONNECT_URL: "ftp://127.0.0.1" })).toThrow(/ANKICONNECT_URL/);
  });
});
