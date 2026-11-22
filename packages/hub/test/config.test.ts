import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("has a default for everything, listening on 127.0.0.1", () => {
    const config = loadConfig({ LOCALAPPDATA: "C:\\Local", APPDATA: "C:\\Roaming" }, "win32");
    expect(config).toEqual({
      mode: "local",
      host: "127.0.0.1",
      port: 7300,
      publicUrl: null,
      setupToken: null,
      serverUrl: null,
      deviceToken: null,
      outboxDir: join("C:\\Local", "Mosaik", "outbox"),
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
      webCovers: false,
      steamCovers: false,
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

  it("in server mode listens everywhere, on the host's PORT, and needs an https PUBLIC_URL", () => {
    const config = loadConfig({
      MOSAIK_MODE: "server",
      PORT: "8080",
      HUB_PORT: "7400",
      PUBLIC_URL: "https://mosaik.example.app/some/path",
      SETUP_TOKEN: "a-long-enough-setup-token",
    });
    expect(config).toMatchObject({
      mode: "server",
      host: "0.0.0.0",
      port: 8080,
      publicUrl: "https://mosaik.example.app",
      setupToken: "a-long-enough-setup-token",
    });
    expect(() => loadConfig({ MOSAIK_MODE: "server" })).toThrow(/PUBLIC_URL: required/);
    expect(() => loadConfig({ MOSAIK_MODE: "server", PUBLIC_URL: "http://mosaik.example.app" })).toThrow(
      /must be https/,
    );
    // Plain http is fine on this computer, for trying the server mode
    expect(loadConfig({ MOSAIK_MODE: "server", PUBLIC_URL: "http://localhost:7300" }).publicUrl).toBe(
      "http://localhost:7300",
    );
    expect(() =>
      loadConfig({ MOSAIK_MODE: "server", PUBLIC_URL: "https://a.app", SETUP_TOKEN: "short" }),
    ).toThrow(/SETUP_TOKEN/);
  });

  it("in local mode ignores PORT and the server settings", () => {
    const config = loadConfig({ PORT: "8080", PUBLIC_URL: "https://a.app", SETUP_TOKEN: "x".repeat(20) });
    expect(config).toMatchObject({
      mode: "local",
      host: "127.0.0.1",
      port: 7300,
      publicUrl: null,
      setupToken: null,
    });
  });

  it("in agent mode needs the server and a device token", () => {
    const token = "mkd_" + "a".repeat(43);
    const config = loadConfig({
      MOSAIK_MODE: "agent",
      SERVER_URL: "https://mosaik.example.app/x",
      DEVICE_TOKEN: token,
    });
    expect(config).toMatchObject({
      mode: "agent",
      serverUrl: "https://mosaik.example.app",
      deviceToken: token,
    });
    expect(() => loadConfig({ MOSAIK_MODE: "agent", DEVICE_TOKEN: token })).toThrow(/SERVER_URL: required/);
    expect(() => loadConfig({ MOSAIK_MODE: "agent", SERVER_URL: "https://a.app" })).toThrow(
      /DEVICE_TOKEN: required/,
    );
    expect(() =>
      loadConfig({ MOSAIK_MODE: "agent", SERVER_URL: "http://a.app", DEVICE_TOKEN: token }),
    ).toThrow(/must be https/);
    expect(() =>
      loadConfig({ MOSAIK_MODE: "agent", SERVER_URL: "https://a.app", DEVICE_TOKEN: "nope" }),
    ).toThrow(/DEVICE_TOKEN/);
    expect(
      loadConfig({
        MOSAIK_MODE: "agent",
        SERVER_URL: "https://a.app",
        DEVICE_TOKEN: token,
        AGENT_OUTBOX: "D:\\out",
      }).outboxDir,
    ).toBe("D:\\out");
  });
});
