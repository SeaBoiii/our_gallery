-- Guestbook entries are independent of media uploads and never use R2 storage.
CREATE TABLE greetings (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  guest_name TEXT CHECK (guest_name IS NULL OR length(guest_name) <= 80),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  deleted_at TEXT,
  CHECK ((status = 'deleted' AND message = '' AND guest_name IS NULL)
    OR (status != 'deleted' AND length(trim(message)) BETWEEN 1 AND 1000))
) STRICT;

CREATE INDEX greetings_cursor ON greetings(status, created_at DESC, id DESC);

INSERT INTO settings (key, value, updated_at)
VALUES ('greetings_enabled', 'true', datetime('now'))
ON CONFLICT(key) DO NOTHING;

-- All new contributions wait for review at launch. Existing media is unchanged.
INSERT INTO settings (key, value, updated_at)
VALUES ('auto_approve_uploads', 'false', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;

UPDATE events SET display_name = 'Nikah & Bride''s Reception'
WHERE slug = 'solemnisation';
