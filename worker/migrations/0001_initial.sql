PRAGMA foreign_keys = ON;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug IN ('solemnisation', 'reception')),
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  display_name TEXT NOT NULL,
  upload_enabled INTEGER NOT NULL DEFAULT 1 CHECK (upload_enabled IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  mime_type TEXT NOT NULL,
  staging_original_object_key TEXT NOT NULL UNIQUE,
  staging_display_object_key TEXT,
  staging_thumbnail_object_key TEXT,
  original_object_key TEXT NOT NULL UNIQUE,
  display_object_key TEXT,
  thumbnail_object_key TEXT,
  original_filename TEXT NOT NULL,
  guest_name TEXT,
  guest_message TEXT,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  display_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (display_size_bytes >= 0),
  thumbnail_size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (thumbnail_size_bytes >= 0),
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  fingerprint TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'reconciling', 'pending', 'approved', 'rejected', 'deleting', 'deleted', 'expired')),
  derivative_status TEXT NOT NULL CHECK (derivative_status IN ('pending', 'ready', 'partial', 'unavailable', 'not_required')),
  last_put_expires_at TEXT NOT NULL,
  upload_expires_at TEXT NOT NULL,
  staging_purged_at TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  deleted_at TEXT,
  UNIQUE (request_id, client_id)
) STRICT;

CREATE TABLE rate_limits (
  key_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, action, window_start)
) STRICT;

CREATE TABLE admin_sessions (
  session_hash TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX media_gallery_cursor ON media(status, event_id, created_at DESC, id DESC);
CREATE INDEX media_stale_uploads ON media(status, upload_expires_at);
CREATE INDEX media_staging_purge ON media(staging_purged_at, last_put_expires_at);
CREATE INDEX media_admin_filter ON media(status, media_type, created_at DESC, id DESC);
CREATE INDEX media_fingerprint ON media(event_id, session_hash, fingerprint, status);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at, revoked_at);

INSERT INTO events (id, slug, name, event_date, display_name, upload_enabled, created_at) VALUES
  ('event-solemnisation', 'solemnisation', 'solemnisation', '2027-08-21', 'Solemnisation', 1, datetime('now')),
  ('event-reception', 'reception', 'reception', '2027-08-22', 'Groom''s Reception', 1, datetime('now'));

INSERT INTO settings (key, value, updated_at) VALUES
  ('uploads_enabled', 'true', datetime('now')),
  ('auto_approve_uploads', 'env', datetime('now')),
  ('live_wall_source', 'all', datetime('now'));
