PRAGMA foreign_keys = ON;

-- Phase 2 keeps moderation state in media.status. AI state is deliberately
-- separate so every Phase 1 route continues to work while providers are down.
ALTER TABLE media ADD COLUMN source TEXT NOT NULL DEFAULT 'guest'
  CHECK (source IN ('guest', 'photographer'));
ALTER TABLE media ADD COLUMN face_search_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (face_search_enabled IN (0, 1));
ALTER TABLE media ADD COLUMN manual_alt_text TEXT;
ALTER TABLE media ADD COLUMN content_sha256 TEXT;
ALTER TABLE media ADD COLUMN checksum_verified_at TEXT;
ALTER TABLE media ADD COLUMN video_preview_object_key TEXT;

CREATE TABLE media_ai (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  overall_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (overall_status IN ('not_requested','queued','processing','complete','partial','failed','disabled')),
  categorisation_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (categorisation_status IN ('not_requested','queued','processing','complete','partial','failed','disabled')),
  caption_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (caption_status IN ('not_requested','queued','processing','complete','partial','failed','disabled')),
  face_index_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (face_index_status IN ('not_requested','queued','processing','complete','partial','failed','disabled')),
  semantic_index_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (semantic_index_status IN ('not_requested','queued','processing','complete','partial','failed','disabled')),
  caption TEXT,
  scene TEXT,
  objects_json TEXT,
  quality_json TEXT,
  vision_provider TEXT,
  vision_model TEXT,
  vision_model_version TEXT,
  semantic_provider TEXT,
  semantic_model TEXT,
  semantic_model_version TEXT,
  semantic_dimensions INTEGER,
  analysis_schema_version INTEGER NOT NULL DEFAULT 1,
  last_error_code TEXT,
  last_error_message TEXT,
  queued_at TEXT,
  processing_started_at TEXT,
  processed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE media_categories (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source TEXT NOT NULL CHECK (source IN ('ai', 'admin')),
  analysis_schema_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (media_id, category_id, source)
) STRICT;

-- A suppression survives AI reprocessing; deleting an AI category row alone
-- would otherwise allow the model to recreate the incorrect tag.
CREATE TABLE media_category_suppressions (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (media_id, category_id)
) STRICT;

CREATE TABLE detected_faces (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  face_index INTEGER NOT NULL CHECK (face_index >= 0),
  bounding_box_x REAL NOT NULL CHECK (bounding_box_x >= 0 AND bounding_box_x <= 1),
  bounding_box_y REAL NOT NULL CHECK (bounding_box_y >= 0 AND bounding_box_y <= 1),
  bounding_box_width REAL NOT NULL CHECK (bounding_box_width > 0 AND bounding_box_width <= 1),
  bounding_box_height REAL NOT NULL CHECK (bounding_box_height > 0 AND bounding_box_height <= 1),
  embedding_vector_id TEXT NOT NULL UNIQUE,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_model_version TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
  distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine','euclidean','dot-product')),
  face_quality_score REAL CHECK (face_quality_score IS NULL OR (face_quality_score >= 0 AND face_quality_score <= 1)),
  indexed_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (media_id, face_index, embedding_model_version)
) STRICT;

CREATE TABLE media_semantic_vectors (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  embedding_vector_id TEXT NOT NULL UNIQUE,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_model_version TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions > 0),
  distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine','euclidean','dot-product')),
  caption_version TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE face_calibrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine','euclidean','dot-product')),
  match_threshold REAL NOT NULL,
  strong_match_threshold REAL NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (strong_match_threshold >= match_threshold)
) STRICT;

-- ai_jobs doubles as the durable outbox. The deterministic idempotency key is
-- committed atomically with moderation transitions; Queue dispatch is retried.
CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL
    CHECK (job_type IN ('ANALYSE_MEDIA','REPROCESS_MEDIA','DELETE_MEDIA_AI','PURGE_MEDIA_FACES','PURGE_ALL_FACES')),
  media_id TEXT REFERENCES media(id),
  analysis_version INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('queued','dispatched','processing','complete','partial','failed','dismissed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts > 0),
  available_at TEXT NOT NULL,
  leased_until TEXT,
  workflow_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE ai_rate_windows (
  window_start INTEGER PRIMARY KEY,
  reservation_count INTEGER NOT NULL CHECK (reservation_count >= 0),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE search_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE archive_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL
    CHECK (status IN ('draft','inventory','building','partial','complete','failed','cancelled')),
  scope TEXT NOT NULL CHECK (scope IN ('all','event')),
  event_id TEXT REFERENCES events(id),
  shard_size_bytes INTEGER NOT NULL CHECK (shard_size_bytes > 0),
  total_files INTEGER NOT NULL DEFAULT 0 CHECK (total_files >= 0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  processed_files INTEGER NOT NULL DEFAULT 0 CHECK (processed_files >= 0),
  processed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (processed_bytes >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  manifest_json_object_key TEXT,
  manifest_csv_object_key TEXT,
  checksums_object_key TEXT,
  readme_object_key TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE archive_items (
  archive_job_id TEXT NOT NULL REFERENCES archive_jobs(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  event_slug TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_display_name TEXT NOT NULL,
  event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
  original_object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  archive_filename TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT,
  uploaded_at TEXT NOT NULL,
  guest_name TEXT,
  guest_message TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  ai_caption TEXT,
  assigned_part INTEGER,
  processed_at TEXT,
  PRIMARY KEY (archive_job_id, media_id)
) STRICT;

CREATE TABLE archive_parts (
  id TEXT PRIMARY KEY,
  archive_job_id TEXT NOT NULL REFERENCES archive_jobs(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('building','complete','failed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (archive_job_id, event_id, part_number)
) STRICT;

CREATE TABLE archive_artifacts (
  id TEXT PRIMARY KEY,
  archive_job_id TEXT NOT NULL REFERENCES archive_jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('manifest_json','manifest_csv','checksums','readme')),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (archive_job_id, kind)
) STRICT;

CREATE INDEX media_source_gallery ON media(source, status, created_at DESC, id DESC);
CREATE INDEX media_face_search ON media(status, face_search_enabled, id);
CREATE INDEX media_ai_overall ON media_ai(overall_status, updated_at);
CREATE INDEX media_ai_face ON media_ai(face_index_status, updated_at);
CREATE INDEX media_ai_semantic ON media_ai(semantic_index_status, updated_at);
CREATE INDEX media_categories_category ON media_categories(category_id, media_id, source);
CREATE INDEX detected_faces_media ON detected_faces(media_id, deleted_at);
CREATE INDEX detected_faces_vector ON detected_faces(embedding_vector_id, deleted_at);
CREATE INDEX ai_jobs_dispatch ON ai_jobs(status, available_at, priority, created_at);
CREATE INDEX ai_jobs_media ON ai_jobs(media_id, created_at DESC);
CREATE INDEX ai_rate_windows_expiry ON ai_rate_windows(expires_at);
CREATE INDEX search_sessions_expiry ON search_sessions(expires_at);
CREATE INDEX archive_jobs_status ON archive_jobs(status, created_at DESC);
CREATE INDEX archive_items_order ON archive_items(archive_job_id, event_date, event_sequence);
CREATE INDEX archive_parts_job ON archive_parts(archive_job_id, event_id, part_number);

INSERT INTO settings (key, value, updated_at) VALUES
  ('event_mode', 'live', datetime('now')),
  ('ai_enabled', 'true', datetime('now')),
  ('face_search_enabled', 'false', datetime('now')),
  ('auto_ai_processing', 'true', datetime('now')),
  ('semantic_search_enabled', 'true', datetime('now')),
  ('ai_processing_paused', 'false', datetime('now'));

INSERT INTO categories (id, slug, display_name, enabled, sort_order, created_at, updated_at) VALUES
  ('category-couple', 'couple', 'Couple', 1, 10, datetime('now'), datetime('now')),
  ('category-family', 'family', 'Family', 1, 20, datetime('now'), datetime('now')),
  ('category-friends', 'friends', 'Friends', 1, 30, datetime('now'), datetime('now')),
  ('category-guests', 'guests', 'Guests', 1, 40, datetime('now'), datetime('now')),
  ('category-group-photo', 'group-photo', 'Group Photo', 1, 50, datetime('now'), datetime('now')),
  ('category-portrait', 'portrait', 'Portrait', 1, 60, datetime('now'), datetime('now')),
  ('category-selfie', 'selfie', 'Selfie', 1, 70, datetime('now'), datetime('now')),
  ('category-candid', 'candid', 'Candid', 1, 80, datetime('now'), datetime('now')),
  ('category-ceremony', 'ceremony', 'Ceremony', 1, 90, datetime('now'), datetime('now')),
  ('category-reception', 'reception', 'Reception', 1, 100, datetime('now'), datetime('now')),
  ('category-stage-pelamin', 'stage-pelamin', 'Stage / Pelamin', 1, 110, datetime('now'), datetime('now')),
  ('category-decor', 'decor', 'Decor', 1, 120, datetime('now'), datetime('now')),
  ('category-venue', 'venue', 'Venue', 1, 130, datetime('now'), datetime('now')),
  ('category-food', 'food', 'Food', 1, 140, datetime('now'), datetime('now')),
  ('category-wedding-details', 'wedding-details', 'Wedding Details', 1, 150, datetime('now'), datetime('now')),
  ('category-outfit', 'outfit', 'Outfit', 1, 160, datetime('now'), datetime('now')),
  ('category-table', 'table', 'Table', 1, 170, datetime('now'), datetime('now')),
  ('category-entrance', 'entrance', 'Entrance', 1, 180, datetime('now'), datetime('now')),
  ('category-performance', 'performance', 'Performance', 1, 190, datetime('now'), datetime('now')),
  ('category-behind-scenes', 'behind-scenes', 'Behind the Scenes', 1, 200, datetime('now'), datetime('now')),
  ('category-night', 'night', 'Night', 1, 210, datetime('now'), datetime('now')),
  ('category-other', 'other', 'Other', 1, 220, datetime('now'), datetime('now'));

PRAGMA optimize;
