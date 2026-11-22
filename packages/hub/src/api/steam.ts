/**
 * Game covers from Steam: chosen by the user or, if they turned it on (STEAM_COVERS), found by the
 * exact title. Steam's store search needs no key, and most games have a portrait cover (600×900) on
 * Steam's image server. Nothing else is sent to Steam unless the user asks for a search: the query (the
 * game's title) is what Steam receives.
 */
import type { SteamCandidate } from "@mosaik/shared";
import { z } from "zod";
import type { Database } from "../db/database.ts";
import { type CoverResult, MAX_COVER_BYTES, imageType, storeCover } from "./covers.ts";

const STORE_SEARCH = "https://store.steampowered.com/api/storesearch/";
const IMAGES = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps";

/** A portrait cover first; the wide header when a game has none. */
export const steamImages = (appId: number) => [
  `${IMAGES}/${appId}/library_600x900.jpg`,
  `${IMAGES}/${appId}/header.jpg`,
];

const searchSchema = z.object({
  items: z
    .array(z.object({ id: z.number().int().positive(), name: z.string(), type: z.string().optional() }))
    .default([]),
});

export async function searchSteam(
  query: string,
  fetchImpl: typeof fetch = fetch,
  limit = 8,
): Promise<SteamCandidate[]> {
  const term = query.trim().slice(0, 120);
  if (term.length < 2) return [];
  const url = new URL(STORE_SEARCH);
  url.searchParams.set("term", term);
  url.searchParams.set("l", "spanish");
  url.searchParams.set("cc", "US");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Steam answered HTTP ${response.status}`);
  const parsed = searchSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Steam answered something unexpected");
  return parsed.data.items
    .filter((item) => item.type === undefined || item.type === "app")
    .slice(0, limit)
    .map((item) => {
      const [image, header] = steamImages(item.id) as [string, string];
      return { appId: item.id, name: item.name, image, header };
    });
}

/** Downloads a Steam game's cover and keeps it as the content's cover, chosen by the user. */
export async function setSteamCover(
  db: Database,
  contentId: string,
  appId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CoverResult> {
  if (!db.prepare("SELECT 1 FROM contents WHERE id = ?").get(contentId)) {
    return { ok: false, status: 404, error: "not_found" };
  }
  const data = await downloadCover(appId, fetchImpl);
  return data
    ? storeCover(db, contentId, data, "steam")
    : { ok: false, status: 404, error: "no_steam_image" };
}

async function downloadCover(appId: number, fetchImpl: typeof fetch): Promise<Uint8Array | null> {
  for (const url of steamImages(appId)) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length === 0 || data.length > MAX_COVER_BYTES || !imageType(data)) continue;
      return data;
    } catch {
      // Try the next image, or give up below
    }
  }
  return null;
}

/** Titles compared without case, spacing, punctuation or trademark signs. */
const gameTitle = (title: string) =>
  title
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The cover of the one Steam game with exactly this title, or null. */
export async function findSteamCover(
  title: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const wanted = gameTitle(title);
  if (wanted === "") return null;
  const same = (await searchSteam(title, fetchImpl, 50)).filter((game) => gameTitle(game.name) === wanted);
  // Two games with one name: the user picks
  return same.length === 1 ? downloadCover(same[0]!.appId, fetchImpl) : null;
}
