-- Cover images of contents: GSM's game images, and (only if the user turns it on) YouTube thumbnails.

CREATE TABLE covers (
  content_id TEXT PRIMARY KEY,     -- 'gsm:<game_id>', 'yt:<videoId>'
  mime TEXT NOT NULL,              -- image/png, image/jpeg, ...
  data BLOB NOT NULL,
  etag TEXT NOT NULL,              -- sha1 of the image, to rewrite it only when it changes
  fetched_at INTEGER NOT NULL      -- ms
) STRICT;
