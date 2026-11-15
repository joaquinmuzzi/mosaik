// Takes a screenshot of Home, Contents and Anki in every design, for comparing them.
//
//   npm run screenshots                      against the running dashboard (http://127.0.0.1:5173)
//   MOSAIK_URL=http://127.0.0.1:7300 npm run screenshots
//
// Uses the Chrome (or Edge) installed on this computer through playwright-core: no browser is
// downloaded. The pictures show your real data, so docs/designs/*.png is ignored by git.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.MOSAIK_URL ?? "http://127.0.0.1:5173";
const OUT = new URL("../docs/designs/", import.meta.url);
const DESIGNS = ["actual", "kechimochi", "minimal", "bento", "spielstand"];
const PAGES = [
  ["inicio", "#/"],
  ["contenido", "#/contenido"],
  ["anki", "#/anki"],
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
  for (const design of DESIGNS) {
    for (const [name, hash] of PAGES) {
      await page.goto(`${BASE}/?design=${design}${hash}`, { waitUntil: "networkidle" });
      // Charts draw after their data arrives, and the feed loads a few days in the background
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1200);
      const file = new URL(`${design}-${name}.png`, OUT);
      await page.screenshot({ path: fileURLToPath(file), fullPage: true });
      console.log(`docs/designs/${design}-${name}.png`);
    }
  }
} finally {
  await browser.close();
}
