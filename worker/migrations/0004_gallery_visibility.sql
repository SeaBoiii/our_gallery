-- Compatibility rollout: keep both galleries available until the frontend is
-- deployed and previously issued 15-minute R2 GET signatures have drained.
-- The release operator then activates automatic control through admin settings.
INSERT INTO settings(key,value,updated_at)
VALUES ('gallery_visibility', '{"control":"manual","mode":"both","lastSingleDay":"solemnisation","overrideUntil":null}', datetime('now'))
ON CONFLICT(key) DO NOTHING;

-- Presentation only: media references, object keys, dates and upload flags stay intact.
UPDATE events SET name = 'Our Wedding', display_name = 'Our Wedding · 21 August' WHERE slug = 'solemnisation';
UPDATE events SET name = 'Our Wedding', display_name = 'Our Wedding · 22 August' WHERE slug = 'reception';
