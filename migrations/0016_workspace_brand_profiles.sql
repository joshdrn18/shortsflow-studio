ALTER TABLE workspace_brand_kits ADD COLUMN active_profile_id TEXT;

CREATE TABLE IF NOT EXISTS workspace_brand_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  subtitle_config_json TEXT NOT NULL DEFAULT '{}',
  watermark_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_brand_profiles
  ON workspace_brand_profiles(workspace_id, updated_at DESC);
