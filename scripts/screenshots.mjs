// Takes a screenshot of the main pages of the dashboard.
//
//   npm run screenshots                      against the running dashboard (http://127.0.0.1:5173)
//   MOSAIK_URL=http://127.0.0.1:7300 npm run screenshots
//
// Uses the Chrome (or Edge) installed on this computer through playwright-core: no browser is
// downloaded. The pictures show your real data, so docs/screenshots/ is ignored by git.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.MOSAIK_URL ?? "http://127.0.0.1:5173";
const OUT = new URL("../docs/screenshots/", import.meta.url);
const PAGES = [
  ["panel", "#/"],
  ["biblioteca", "#/contenido"],
  ["anki", "#/anki"],
  ["buscar", "#/buscar?q=Anwalt"],
  ["fuentes", "#/fuentes"],
];
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const executablePath = BROWSERS.find((path) => existsSync(path));
if (!executablePath) throw new Error("No Chrome or Edge found to take the screenshots with.");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const [name, hash] of PAGES) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
    // Charts draw after their data arrives, and the feed loads a few days in the background
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const file = new URL(`${name}.png`, OUT);
    await page.screenshot({ path: fileURLToPath(file), fullPage: true });
    console.log(`docs/screenshots/${name}.png`);
  }
} finally {
  await browser.close();
}
