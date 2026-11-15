/**
 * Cover images. GSM's game images are copied by the GSM connector. YouTube thumbnails are fetched
 * from YouTube only when the user turned it on (YOUTUBE_THUMBNAILS), because asking for one tells
 * YouTube the video id; each one is fetched once and kept in the database. The user can also choose a
 * cover for any content (`setManualCover`): it wins over the others and no sync replaces it.
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
      `INSERT INTO covers (content_id, mime, data, etag, fetched_at, origin) VALUES (?, ?, ?, ?, ?, 'youtube')
       ON CONFLICT (content_id) DO NOTHING`,
    ).run(contentId, mime, data, createHash("sha1").update(data).digest("hex"), (options.now ?? Date.now)());
    return { mime, data };
  } catch {
    // Offline, or YouTube did not answer: no cover this time
    return null;
  }
}

/** The largest cover the user can upload. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** The image type of some bytes, by their signature (not by what the browser claims), or null. */
export function imageType(data: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  return null;
}

export type CoverResult = { ok: true } | { ok: false; status: 400 | 404 | 413; error: string };

/** Keeps an image as the content's cover: one the user uploaded, or one they picked on Steam. */
export function storeCover(
  db: Database,
  contentId: string,
  data: Uint8Array,
  origin: "manual" | "steam",
  now = Date.now(),
): CoverResult {
  if (!db.prepare("SELECT 1 FROM contents WHERE id = ?").get(contentId)) {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (data.length > MAX_COVER_BYTES) return { ok: false, status: 413, error: "too_large" };
  const mime = imageType(data);
  if (!mime) return { ok: false, status: 400, error: "not_an_image" };
  db.prepare(
    `INSERT INTO covers (content_id, mime, data, etag, fetched_at, origin) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (content_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, etag = excluded.etag,
       fetched_at = excluded.fetched_at, origin = excluded.origin`,
  ).run(contentId, mime, data, createHash("sha1").update(data).digest("hex"), now, origin);
  return { ok: true };
}

/** Keeps the image the user uploaded as the content's cover. */
export const setManualCover = (db: Database, contentId: string, data: Uint8Array, now = Date.now()) =>
  storeCover(db, contentId, data, "manual", now);

/**
 * Removes the cover the user chose (uploaded or from Steam). GSM's image comes back on the next GSM sync, and a YouTube thumbnail
 * on the next view (if turned on).
 */
export function removeManualCover(db: Database, contentId: string): boolean {
  return (
    Number(
      db.prepare("DELETE FROM covers WHERE content_id = ? AND origin IN ('manual', 'steam')").run(contentId)
        .changes,
    ) > 0
  );
}
