-- Events pushed by sources (Deuchan), as received, and the daily totals they report.

CREATE TABLE raw_events (
  id TEXT PRIMARY KEY,             -- chosen by the source; a repeated id is ignored
  source TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'watch_interval' | 'day_total' | 'video_removed'
  received_at INTEGER NOT NULL,    -- ms
  payload TEXT NOT NULL            -- the validated event
) STRICT;
CREATE INDEX raw_events_kind ON raw_events (source, kind);

-- What a source shows for a whole day (Deuchan: its dashboard, corrections and other computers
-- included). Rebuilt from raw_events: per day, the snapshot with the newest `at`.
CREATE TABLE day_totals (
  source TEXT NOT NULL,
  day TEXT NOT NULL,               -- the source's own day (Deuchan: local midnight)
  seconds REAL NOT NULL,
  at INTEGER NOT NULL,             -- when the snapshot was taken, ms
  PRIMARY KEY (source, day)
) STRICT;
