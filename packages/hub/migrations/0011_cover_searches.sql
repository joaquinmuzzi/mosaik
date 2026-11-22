-- Covers Mosaik looks for by itself (covers.origin 'web': the image of the content's page; 'steam-auto':
-- the Steam game with exactly the same title). One row per content, with how its last search ended, so
-- that a page without an image is not asked again every few minutes.
CREATE TABLE cover_searches (
  content_id TEXT PRIMARY KEY,
  searched_at INTEGER NOT NULL,    -- ms
  -- 'found' | 'none' (it has no image of its own) | 'error' (it could not be read)
  -- | 'dismissed' (the user removed the one that was found: it is not looked for again)
  result TEXT NOT NULL,
  attempts INTEGER NOT NULL,       -- searches since the last one that found something
  error TEXT
) STRICT;
