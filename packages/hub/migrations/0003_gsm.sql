-- GameSentenceMiner, as read from gsm.db (raw), and the common model of what was read and watched.

CREATE TABLE raw_gsm_lines (
  id TEXT PRIMARY KEY,
  game_id TEXT,
  game_name TEXT,
  line_text TEXT,
  timestamp REAL NOT NULL,         -- GSM's own: epoch seconds with decimals
  language TEXT,                   -- GSM's language setting when the line was read
  note_ids TEXT,                   -- JSON list of the Anki notes mined from the line (strings)
  last_modified REAL NOT NULL,     -- epoch seconds; the timestamp when GSM recorded none
  payload TEXT NOT NULL,           -- the whole row, as read
  synced_at INTEGER NOT NULL,      -- ms
  removed_at INTEGER               -- deleted from GSM (lines of archived days are not marked)
) STRICT;
CREATE INDEX raw_gsm_lines_game ON raw_gsm_lines (game_id, timestamp);

CREATE TABLE raw_gsm_games (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,           -- the row without its cover image
  synced_at INTEGER NOT NULL
) STRICT;

CREATE TABLE raw_gsm_breaks (
  timestamp REAL PRIMARY KEY       -- reading breaks the user marked, epoch seconds
) STRICT;

-- Common model. Each source rebuilds its own rows (`source`) from its raw tables.

CREATE TABLE contents (
  id TEXT PRIMARY KEY,             -- 'gsm:<game_id>', 'yt:<videoId>', ...
  source TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'game' | 'video' | 'book' | 'deck'
  title TEXT,
  external_id TEXT,
  parent_id TEXT,
  total_units INTEGER,
  unit TEXT,
  meta TEXT                        -- JSON
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  medium TEXT NOT NULL,            -- 'game' | 'video' | 'reading'
  language TEXT NOT NULL,
  content_id TEXT REFERENCES contents (id),
  start_ts INTEGER NOT NULL,       -- ms
  end_ts INTEGER NOT NULL,
  seconds REAL NOT NULL,           -- active time, as the source's own rules count it
  units INTEGER,                   -- e.g. characters read
  unit TEXT,
  lines INTEGER
) STRICT;
CREATE INDEX sessions_start ON sessions (start_ts);

CREATE TABLE lines (
  id TEXT PRIMARY KEY,             -- 'gsm:<line id>'
  source TEXT NOT NULL,
  content_id TEXT,
  session_id TEXT,
  ts INTEGER NOT NULL,             -- ms
  text TEXT NOT NULL,
  language TEXT,
  chars INTEGER NOT NULL,          -- characters as the source counts them
  seconds REAL NOT NULL,           -- reading time credited to this line; days add these up
  note_ids TEXT                    -- JSON list of Anki note ids (numbers)
) STRICT;
CREATE INDEX lines_ts ON lines (ts);
CREATE INDEX lines_session ON lines (session_id);

-- Sentence search. Trigrams find a word inside German compounds ("wand" in "Einwand") and work for
-- languages without spaces; searches need at least three characters.
CREATE VIRTUAL TABLE lines_fts USING fts5 (
  text,
  content = 'lines',
  content_rowid = 'rowid',
  tokenize = 'trigram remove_diacritics 1'
);
