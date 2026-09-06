PRAGMA foreign_keys = ON;

-- archive_items_order_v2 has the full archive_items_order prefix, so keeping
-- both would duplicate write and storage work during the inventory snapshot.
DROP INDEX IF EXISTS archive_items_order;

-- Event-scoped builder runs filter by event_slug before walking the same
-- stable keyset order used by all-event inventory paging.
CREATE INDEX archive_items_event_order
  ON archive_items(archive_job_id, event_slug, event_date, event_sequence, media_id);

PRAGMA optimize;
