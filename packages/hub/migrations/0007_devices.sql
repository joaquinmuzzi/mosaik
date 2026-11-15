-- The computer each piece of data was read on, so that several computers can send to one Mosaik.
-- Everything read so far was read on the hub's own computer: 'principal'.

-- GSM is different on each computer: its lines, games, breaks and sessions belong to one of them.
-- (Anki is the same collection everywhere, synced by AnkiWeb, so its tables need no device.)
ALTER TABLE raw_gsm_lines ADD COLUMN device TEXT NOT NULL DEFAULT 'principal';
ALTER TABLE raw_gsm_games ADD COLUMN device TEXT NOT NULL DEFAULT 'principal';
ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT 'principal';

-- Breaks were keyed by their time alone; two computers may mark the same second
CREATE TABLE raw_gsm_breaks_new (
  device TEXT NOT NULL DEFAULT 'principal',
  timestamp REAL NOT NULL,         -- reading breaks the user marked, epoch seconds
  PRIMARY KEY (device, timestamp)
) STRICT;
INSERT INTO raw_gsm_breaks_new (timestamp) SELECT timestamp FROM raw_gsm_breaks;
DROP TABLE raw_gsm_breaks;
ALTER TABLE raw_gsm_breaks_new RENAME TO raw_gsm_breaks;

-- One state per source and computer: each computer resumes from its own cursor
CREATE TABLE connector_state_new (
  source TEXT NOT NULL,      -- 'anki' | 'gsm' | 'deuchan' | ...
  device TEXT NOT NULL DEFAULT 'principal',
  cursor TEXT,               -- JSON: whatever the connector needs to resume
  last_run_at INTEGER,       -- when the last run started
  last_ok_at INTEGER,        -- when the last successful run finished
  last_error TEXT,           -- error of the last run, NULL if it succeeded
  last_summary TEXT,         -- JSON: what the last successful run did (counts), for the dashboard
  PRIMARY KEY (source, device)
) STRICT;
INSERT INTO connector_state_new (source, cursor, last_run_at, last_ok_at, last_error, last_summary)
  SELECT source, cursor, last_run_at, last_ok_at, last_error, last_summary FROM connector_state;
DROP TABLE connector_state;
ALTER TABLE connector_state_new RENAME TO connector_state;
