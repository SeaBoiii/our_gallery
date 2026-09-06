-- Archive lease fencing and durable shard plans.
ALTER TABLE archive_jobs ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE archive_items ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video'));
ALTER TABLE archive_items ADD COLUMN width INTEGER;
ALTER TABLE archive_items ADD COLUMN height INTEGER;
ALTER TABLE archive_items ADD COLUMN duration_seconds REAL;
ALTER TABLE archive_items ADD COLUMN source TEXT NOT NULL DEFAULT 'guest' CHECK (source IN ('guest','photographer'));
ALTER TABLE archive_items ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending','approved','rejected'));

CREATE TABLE archive_plans (
  archive_job_id TEXT NOT NULL REFERENCES archive_jobs(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id),
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  plan_sha256 TEXT NOT NULL CHECK (length(plan_sha256) = 64),
  file_count INTEGER NOT NULL CHECK (file_count > 0),
  status TEXT NOT NULL CHECK (status IN ('planning','planned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (archive_job_id,event_id,part_number),
  UNIQUE (archive_job_id,plan_sha256)
) STRICT;

CREATE TABLE archive_plan_items (
  archive_job_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  media_id TEXT NOT NULL,
  archive_filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (archive_job_id,media_id),
  FOREIGN KEY (archive_job_id,event_id,part_number) REFERENCES archive_plans(archive_job_id,event_id,part_number) ON DELETE CASCADE,
  FOREIGN KEY (archive_job_id,media_id) REFERENCES archive_items(archive_job_id,media_id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX archive_plan_filename_unique
  ON archive_plan_items(archive_job_id,archive_filename COLLATE NOCASE);
CREATE INDEX archive_plan_part_items
  ON archive_plan_items(archive_job_id,event_id,part_number,media_id);

PRAGMA optimize;
