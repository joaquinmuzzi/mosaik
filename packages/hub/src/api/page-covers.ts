/**
 * The image of a web page (an episode, a podcast, a channel), from what the page says about itself:
 * `og:image`, `twitter:image` or its structured data (JSON-LD). An image that the site's front page also
 * has is the site's logo, not the content's, and does not count. For sites that only give a logo there
 * can be a rule of their own (`SITE_RULES`).
 */
import type { PublicGet } from "../public-http.ts";
import { MAX_COVER_BYTES, imageType } from "./covers.ts";

const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/** Images that say there is no image yet (Twitch, while a video is being prepared). */
const PLACEHOLDER = /\/_404\/|404_processing/;

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#x([\da-f]{1,6})|#(\d{1,7})|([a-z]+));/gi,
    (whole: string, hex?: string, decimal?: string, name?: string) => {
      if (name) return ENTITIES[name.toLowerCase()] ?? whole;
      const code = hex ? parseInt(hex, 16) : Number(decimal);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1]!.toLowerCase();
    if (!found.has(name)) found.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return found;
}

function metaImages(html: string): string[] {
  const og: string[] = [];
  const twitter: string[] = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const at = attributes(tag);
    const name = (at.get("property") ?? at.get("name") ?? "").toLowerCase();
    const content = at.get("content")?.trim();
    if (!content) continue;
    if (name === "og:image" || name === "og:image:url" || name === "og:image:secure_url") og.push(content);
    if (name === "twitter:image" || name === "twitter:image:src") twitter.push(content);
  }
  return [...og, ...twitter];
}

/** `thumbnailUrl` of the things a page describes in its structured data. */
function structuredImages(html: string): string[] {
  const images: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, inner] of Object.entries(value)) {
      if (key === "thumbnailUrl") {
        for (const image of Array.isArray(inner) ? (inner as unknown[]) : [inner])
          if (typeof image === "string") images.push(image);
      } else {
        visit(inner, depth + 1);
      }
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!), 0);
    } catch {
      // Not valid JSON: nothing to read there
    }
  }
  return images;
}

/** Sites whose pages only give the site's logo in their metadata. */
const SITE_RULES: { host: RegExp; images: (html: string) => string[] }[] = [
  {
    // The cover of the series, in the header of each of its episodes
    host: /^(www\.)?aniworld\.to$/,
    images: (html) => {
      const match = /data-src="(\/public\/img\/cover\/[^"]*_220x330\.\w+)"/.exec(html);
      return match ? [decodeEntities(match[1]!)] : [];
    },
  },
];

function absolute(images: string[], base: string): string[] {
  const urls: string[] = [];
  for (const image of images) {
    if (!URL.canParse(image, base)) continue;
    const url = new URL(image, base);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol === "https:" && !PLACEHOLDER.test(url.pathname) && !urls.includes(url.href))
      urls.push(url.href);
  }
  return urls;
}

/** The images a page offers, best first. */
export function pageImages(html: string, url: string): string[] {
  const rule = SITE_RULES.find(({ host }) => host.test(new URL(url).hostname));
  return absolute([...(rule?.images(html) ?? []), ...metaImages(html), ...structuredImages(html)], url);
}

/** Two addresses of one image can differ in a version or a size (`logo.jpg?v=2`). */
const imageKey = (url: string) => url.replace(/[?#].*$/, "");

/** The images of each site's front page, kept while a round of searches lasts. */
export type FrontPages = Map<string, Set<string>>;

async function readPage(url: string, get: PublicGet): Promise<{ html: string; url: string } | null> {
  const response = await get(url, { accept: "text/html", maxBytes: MAX_PAGE_BYTES });
  if (response.status === 404 || response.status === 410) return null;
  if (response.status !== 200) throw new Error(`${new URL(url).hostname} answered HTTP ${response.status}`);
  return { html: new TextDecoder().decode(response.body), url: response.url };
}

const isFrontPage = (url: URL) => url.pathname === "/" && url.search === "";

/** The image of a page, or null when it has none of its own. Rejects when it could not be known. */
export async function findPageCover(
  address: string,
  get: PublicGet,
  frontPages: FrontPages = new Map(),
): Promise<Uint8Array | null> {
  const asked = new URL(address);
  // The front page of a site is not a content
  if (asked.protocol !== "https:" || isFrontPage(asked)) return null;
  const page = await readPage(asked.href, get);
  // Sent to the front page: what was there is gone
  if (!page || isFrontPage(new URL(page.url))) return null;
  const images = pageImages(page.html, page.url);
  if (images.length === 0) return null;

  const { origin } = new URL(page.url);
  let logos = frontPages.get(origin);
  if (!logos) {
    const front = await readPage(`${origin}/`, get);
    logos = new Set(front ? pageImages(front.html, front.url).map(imageKey) : []);
    frontPages.set(origin, logos);
  }
  let failure: Error | null = null;
  for (const image of images.slice(0, 5)) {
    if (logos.has(imageKey(image))) continue;
    try {
      const response = await get(image, {
        accept: "image/webp,image/jpeg,image/png",
        maxBytes: MAX_COVER_BYTES,
      });
      if (response.status === 200 && imageType(response.body)) return response.body;
    } catch (error) {
      // Try the next one
      failure = error as Error;
    }
  }
  if (failure) throw failure;
  return null;
}
