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

UPDATE settings SET value='true',updated_at=datetime('now') WHERE key='face_search_enabled';

INSERT OR IGNORE INTO face_calibrations (
  id,provider,model,model_version,dimensions,distance_metric,match_threshold,strong_match_threshold,notes,active,created_at,updated_at
) VALUES (
  'calibration-development-mock','mock','deterministic-development-face','mock-v1',16,'cosine',0.35,0.72,
  'Development-only deterministic thresholds. Never copy these values to a production provider.',1,datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO media_ai (
  media_id,overall_status,categorisation_status,caption_status,face_index_status,semantic_index_status,
  caption,scene,vision_provider,vision_model,vision_model_version,semantic_provider,semantic_model,semantic_model_version,
  semantic_dimensions,analysis_schema_version,processed_at,updated_at
) VALUES
  ('00000000-0000-4000-8000-000000000101','complete','complete','complete','complete','complete',
   'A quiet wedding moment before the ceremony.','wedding venue','mock','deterministic-development-vision','mock-v1',
   'mock','deterministic-development-semantic','mock-v1',16,1,datetime('now'),datetime('now')),
  ('00000000-0000-4000-8000-000000000102','partial','disabled','disabled','disabled','disabled',
   NULL,NULL,'mock','deterministic-development-vision','mock-v1',NULL,NULL,NULL,NULL,1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO media_categories(media_id,category_id,confidence,source,analysis_schema_version,created_at,updated_at) VALUES
  ('00000000-0000-4000-8000-000000000101','category-candid',0.93,'ai',1,datetime('now'),datetime('now')),
  ('00000000-0000-4000-8000-000000000101','category-ceremony',0.88,'ai',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO detected_faces(
  id,media_id,face_index,bounding_box_x,bounding_box_y,bounding_box_width,bounding_box_height,
  embedding_vector_id,embedding_provider,embedding_model,embedding_model_version,embedding_dimensions,distance_metric,
  face_quality_score,indexed_at,created_at,deleted_at
) VALUES (
  'development-face-101-0','00000000-0000-4000-8000-000000000101',0,0.2,0.12,0.6,0.72,
  'f:00000000-0000-4000-8000-000000000101:0:mockv1','mock','deterministic-development-face','mock-v1',16,'cosine',
  0.92,datetime('now'),datetime('now'),NULL
);
