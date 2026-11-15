-- Server mode: the one account, its login sessions, and the computers (devices) allowed to send data.
-- None of this is used in local mode. Secrets are never stored: passwords as scrypt hashes, session and
-- device tokens as SHA-256 hashes (they are long random values, so a fast hash is enough).

CREATE TABLE account (
  id INTEGER PRIMARY KEY CHECK (id = 1),   -- there is only one
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- 'scrypt$N$r$p$salt$hash', base64url
  created_at INTEGER NOT NULL              -- ms
) STRICT;

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT
) STRICT;

CREATE TABLE devices (
  name TEXT PRIMARY KEY,                   -- the device of the data it sends ('notebook', ...)
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
) STRICT;
