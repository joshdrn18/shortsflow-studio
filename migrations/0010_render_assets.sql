-- Bind each render asset to the exact clip metadata snapshot it was produced from.
ALTER TABLE clip_assets ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_clip_assets_latest_render ON clip_assets(clip_id, asset_type, version DESC);
