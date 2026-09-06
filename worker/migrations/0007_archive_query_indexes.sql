PRAGMA foreign_keys = ON;

-- Builder write validation and privacy invalidation both begin from a media
-- item and archive job. These composite indexes support those checks as
-- the immutable inventory approaches the 100,000-file production target.
CREATE INDEX archive_items_media_job
  ON archive_items(media_id, archive_job_id);
CREATE INDEX archive_items_part_coverage
  ON archive_items(archive_job_id, event_id, assigned_part, media_id);
CREATE INDEX archive_items_order_v2
  ON archive_items(archive_job_id, event_date, event_sequence, media_id);

PRAGMA optimize;
