CREATE TABLE upload_requests (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'prepared')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX upload_requests_expiry ON upload_requests(expires_at);
