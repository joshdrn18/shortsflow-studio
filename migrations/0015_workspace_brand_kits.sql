CREATE TABLE IF NOT EXISTS workspace_brand_kits (
  workspace_id TEXT PRIMARY KEY,
  kit_name TEXT NOT NULL DEFAULT 'My Brand',
  subtitle_config_json TEXT NOT NULL DEFAULT '{}',
  watermark_config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
