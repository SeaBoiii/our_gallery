-- Development-only metadata fixtures. The local R2 emulator does not expose
-- hosted S3 presigned URLs, so the frontend's mock mode supplies the visual
-- sample assets while these rows exercise D1 statistics and moderation.
INSERT OR IGNORE INTO media (
  id, request_id, client_id, event_id, media_type, mime_type,
  staging_original_object_key, staging_display_object_key, staging_thumbnail_object_key,
  original_object_key, display_object_key, thumbnail_object_key, original_filename,
  guest_name, guest_message, size_bytes, display_size_bytes, thumbnail_size_bytes,
  width, height, duration_seconds, fingerprint, intent_hash, session_hash,
  status, derivative_status, last_put_expires_at, upload_expires_at, staging_purged_at,
  created_at, approved_at, rejected_at, deleted_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
    'event-solemnisation', 'photo', 'image/jpeg',
    'staging/2027-08-21/00000000-0000-4000-8000-000000000101/original.jpg', NULL, NULL,
    'originals/2027-08-21/00000000-0000-4000-8000-000000000101/original.jpg', NULL, NULL, 'sample-solemnisation.jpg',
    'Aisyah', 'A quiet moment before the ceremony.', 7340032, 0, 0,
    3024, 4032, NULL, printf('%064d', 101), 'development-intent-101', 'development-session',
    'pending', 'unavailable', '2027-08-21T01:10:00.000Z', '2027-08-21T01:30:00.000Z', NULL,
    '2027-08-21T01:00:00.000Z', NULL, NULL, NULL
  ),
  (
    '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000302',
    'event-reception', 'video', 'video/mp4',
    'staging/2027-08-22/00000000-0000-4000-8000-000000000102/original.mp4', NULL, NULL,
    'originals/2027-08-22/00000000-0000-4000-8000-000000000102/original.mp4', NULL, NULL, 'sample-arrival.mp4',
    'The cousins', 'The room when you both arrived!', 90177536, 0, 0,
    1920, 1080, 18.0, printf('%064d', 102), 'development-intent-102', 'development-session',
    'pending', 'not_required', '2027-08-22T04:10:00.000Z', '2027-08-22T04:30:00.000Z', NULL,
    '2027-08-22T04:00:00.000Z', NULL, NULL, NULL
  ),
  (
    '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000303',
    'event-reception', 'photo', 'image/jpeg',
    'staging/2027-08-22/00000000-0000-4000-8000-000000000103/original.jpg', NULL, NULL,
    'originals/2027-08-22/00000000-0000-4000-8000-000000000103/original.jpg', NULL, NULL, 'sample-table.jpg',
    NULL, 'A development-only rejected moderation example.', 5872026, 0, 0,
    4032, 3024, NULL, printf('%064d', 103), 'development-intent-103', 'development-session',
    'rejected', 'unavailable', '2027-08-22T05:10:00.000Z', '2027-08-22T05:30:00.000Z', NULL,
    '2027-08-22T05:00:00.000Z', NULL, '2027-08-22T05:05:00.000Z', NULL
  );

INSERT OR IGNORE INTO audit_log (id, actor, action, target_id, metadata_json, created_at)
VALUES ('development-seed-marker', 'system', 'development_seed_ready', NULL, '{"note":"Use frontend mock media for local visual previews."}', datetime('now'));
