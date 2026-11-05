CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY,
  watermark_enabled INTEGER NOT NULL DEFAULT 1,
  watermark_text TEXT NOT NULL DEFAULT 'YOUR BRAND',
  watermark_position TEXT NOT NULL DEFAULT 'bottom-right' CHECK (watermark_position IN ('top-left','top-right','bottom-left','bottom-right')),
  watermark_opacity REAL NOT NULL DEFAULT 0.72 CHECK (watermark_opacity >= 0.1 AND watermark_opacity <= 1),
  watermark_scale TEXT NOT NULL DEFAULT 'medium' CHECK (watermark_scale IN ('small','medium','large')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);