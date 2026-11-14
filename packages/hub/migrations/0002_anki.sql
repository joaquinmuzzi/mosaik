-- Anki, as AnkiConnect returns it (raw), and the common model derived from it.
-- Times in ms UTC, except `mod`, which Anki keeps in seconds.

CREATE TABLE raw_anki_notes (
  note_id INTEGER PRIMARY KEY,     -- also the note's creation time, ms
  model TEXT NOT NULL,
  deck TEXT NOT NULL,              -- the configured deck it was found in
  fields TEXT NOT NULL,            -- JSON {name: value}, in field order
  tags TEXT NOT NULL,              -- JSON array
  mod INTEGER NOT NULL,            -- Anki's modification time, seconds
  payload TEXT NOT NULL,           -- notesInfo, as received
  synced_at INTEGER NOT NULL,
  removed_at INTEGER               -- no longer in a configured deck (deleted or moved)
) STRICT;

CREATE TABLE raw_anki_cards (
  card_id INTEGER PRIMARY KEY,
  note_id INTEGER NOT NULL,
  deck TEXT NOT NULL,              -- the card's own deck, as Anki reports it
  type INTEGER NOT NULL,           -- 0 new, 1 learning, 2 review, 3 relearning
  queue INTEGER NOT NULL,          -- negative: suspended or buried
  interval INTEGER NOT NULL,       -- days (negative: seconds, while learning)
  due INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  mod INTEGER NOT NULL,            -- seconds
  payload TEXT NOT NULL,           -- cardsInfo without the rendered question, answer and CSS
  synced_at INTEGER NOT NULL,
  removed_at INTEGER
) STRICT;
CREATE INDEX raw_anki_cards_note ON raw_anki_cards (note_id);

CREATE TABLE raw_anki_reviews (
  review_id INTEGER PRIMARY KEY,   -- also the time of the review, ms
  card_id INTEGER NOT NULL,
  usn INTEGER NOT NULL,
  ease INTEGER NOT NULL,           -- 1-4; 0 for manual and rescheduled entries
  ivl INTEGER NOT NULL,            -- days (negative: seconds)
  last_ivl INTEGER NOT NULL,
  factor INTEGER NOT NULL,
  time_ms INTEGER NOT NULL,
  type INTEGER NOT NULL,           -- 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 rescheduled
  deck TEXT NOT NULL               -- the configured deck it was read from
) STRICT;
CREATE INDEX raw_anki_reviews_card ON raw_anki_reviews (card_id);

-- Common model: rebuilt from the raw tables after every sync

CREATE TABLE cards (
  note_id INTEGER PRIMARY KEY,
  word TEXT,
  deck TEXT NOT NULL,
  model TEXT NOT NULL,
  origin TEXT NOT NULL,            -- 'gsm' | 'youtube' | 'refold-1k' | 'unknown'
  content_id TEXT,
  line_id TEXT,
  source_title TEXT,               -- where the note says it came from (MiscInfo), cleaned
  created_ts INTEGER NOT NULL      -- note creation, ms (for premade decks, when the deck was made)
) STRICT;
CREATE INDEX cards_origin ON cards (origin);

CREATE TABLE reviews (
  review_id INTEGER PRIMARY KEY,
  note_id INTEGER,
  card_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  ease INTEGER NOT NULL,
  ivl INTEGER NOT NULL,
  last_ivl INTEGER NOT NULL,
  type INTEGER NOT NULL,
  time_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX reviews_ts ON reviews (ts);
CREATE INDEX reviews_note ON reviews (note_id);
