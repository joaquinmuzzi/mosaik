-- State of each connector, so that a run continues where the last one stopped and the dashboard
-- can show when each source was last synced. Times are UTC milliseconds.
CREATE TABLE connector_state (
  source TEXT PRIMARY KEY,   -- 'anki' | 'gsm' | 'deuchan' | ...
  cursor TEXT,               -- JSON: whatever the connector needs to resume
  last_run_at INTEGER,       -- when the last run started
  last_ok_at INTEGER,        -- when the last successful run finished
  last_error TEXT,           -- error of the last run, NULL if it succeeded
  last_summary TEXT          -- JSON: what the last successful run did (counts), for the dashboard
) STRICT;
