/**
 * Cover images. GSM's game images are copied by the GSM connector. YouTube thumbnails are fetched
 * from YouTube only when the user turned it on (YOUTUBE_THUMBNAILS), because asking for one tells
 * YouTube the video id; each one is fetched once and kept in the database.
 */
import { createHash } from "node:crypto";
import type { Database } from "../db/database.ts";

export interface Cover {
  mime: string;
  data: Uint8Array;
}

const THUMBNAIL = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

export async function getCover(
  db: Database,
  contentId: string,
  options: { youtubeThumbnails: boolean; fetchImpl?: typeof fetch; now?: () => number },
): Promise<Cover | null> {
  const stored = db.prepare("SELECT mime, data FROM covers WHERE content_id = ?").get(contentId) as
    Cover | undefined;
  if (stored) return stored;

  const video = /^yt:([A-Za-z0-9_-]{11})$/.exec(contentId);
  if (!video || !options.youtubeThumbnails) return null;
  const known = db.prepare("SELECT 1 FROM contents WHERE id = ?").get(contentId);
  if (!known) return null;

  try {
    const response = await (options.fetchImpl ?? fetch)(THUMBNAIL(video[1]!), {
      signal: AbortSignal.timeout(5000),
    });
    const mime = response.headers.get("content-type") ?? "";
    if (!response.ok || !mime.startsWith("image/")) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    db.prepare(
      `INSERT INTO covers (content_id, mime, data, etag, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (content_id) DO NOTHING`,
    ).run(contentId, mime, data, createHash("sha1").update(data).digest("hex"), (options.now ?? Date.now)());
    return { mime, data };
  } catch {
    // Offline, or YouTube did not answer: no cover this time
    return null;
  }
}
