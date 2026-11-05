-- Bind every review decision to the exact rendered asset, not just a version number.
ALTER TABLE clip_reviews ADD COLUMN render_asset_id TEXT;
CREATE INDEX IF NOT EXISTS idx_clip_reviews_asset ON clip_reviews(clip_id, render_asset_id, reviewed_at DESC);
