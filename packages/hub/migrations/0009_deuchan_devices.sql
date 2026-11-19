-- Deuchan sends from several computers and Chrome profiles, each with its own device token.
-- Each one sends only what was watched there, so a day of Deuchan is the sum of its devices.

-- The device each pushed event came from. Until now only one Deuchan sent: in server mode its
-- token's device ('deuchan'), in local mode the hub's own computer ('principal').
ALTER TABLE raw_events ADD COLUMN device TEXT NOT NULL DEFAULT 'principal';
UPDATE raw_events SET device = 'deuchan'
 WHERE source = 'deuchan' AND EXISTS (SELECT 1 FROM devices WHERE name = 'deuchan');
UPDATE connector_state SET device = 'deuchan'
 WHERE source = 'deuchan' AND EXISTS (SELECT 1 FROM devices WHERE name = 'deuchan')
   AND NOT EXISTS (SELECT 1 FROM connector_state WHERE source = 'deuchan' AND device = 'deuchan');

-- Per device and day, the newest snapshot. `event_id` is that snapshot in raw_events.
-- `reading_seconds` is the part of `seconds` counted by hand as reading.
DROP TABLE day_totals;
CREATE TABLE day_totals (
  source TEXT NOT NULL,
  device TEXT NOT NULL,
  day TEXT NOT NULL,               -- the source's own day (Deuchan: local midnight)
  seconds REAL NOT NULL,
  reading_seconds REAL NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,             -- when the snapshot was taken, ms
  event_id TEXT NOT NULL,
  PRIMARY KEY (source, device, day)
) STRICT;
