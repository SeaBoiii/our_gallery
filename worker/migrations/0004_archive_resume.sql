ALTER TABLE archive_parts ADD COLUMN plan_sha256 TEXT;

CREATE INDEX archive_parts_plan ON archive_parts(archive_job_id, event_id, part_number, plan_sha256);

PRAGMA optimize;
