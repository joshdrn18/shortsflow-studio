-- Persist editable clip cut metadata through versioned clip_metadata snapshots.
-- The original source remains unchanged in private R2 storage.
CREATE INDEX IF NOT EXISTS idx_clip_metadata_latest ON clip_metadata(clip_id, version DESC);
