PRAGMA foreign_keys = ON;

-- The latest logical analysis and face operation own their writes. A delayed
-- Workflow or cleanup delivery must not overwrite a newer moderation/toggle
-- decision for the same media row.
ALTER TABLE media_ai ADD COLUMN active_analysis_job_id TEXT;
ALTER TABLE media_ai ADD COLUMN active_face_job_id TEXT;
ALTER TABLE ai_jobs ADD COLUMN dispatch_token TEXT;
ALTER TABLE media ADD COLUMN moderation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE media ADD COLUMN face_search_revision INTEGER NOT NULL DEFAULT 0;

-- Any delivery created before dispatch tokens existed is deliberately made
-- dispatchable again. The old Queue message is rejected by schema version and
-- the outbox will publish a fenced replacement.
UPDATE ai_jobs
SET status = 'queued', dispatched_at = NULL, updated_at = datetime('now')
WHERE status = 'dispatched';

CREATE INDEX media_ai_active_analysis_job ON media_ai(active_analysis_job_id);
CREATE INDEX media_ai_active_face_job ON media_ai(active_face_job_id);
CREATE INDEX ai_jobs_dispatch_token ON ai_jobs(id, dispatch_token);
