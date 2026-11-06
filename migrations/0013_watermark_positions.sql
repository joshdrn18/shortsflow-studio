PRAGMA foreign_keys = OFF;

CREATE TABLE workspace_settings_new (
  workspace_id TEXT PRIMARY KEY,
  watermark_enabled INTEGER NOT NULL DEFAULT 1,
  watermark_text TEXT NOT NULL DEFAULT 'YOUR BRAND',
  watermark_position TEXT NOT NULL DEFAULT 'bottom-right'
    CHECK (watermark_position IN ('top-left','top-center','top-right','center','bottom-left','bottom-center','bottom-right')),
  watermark_opacity REAL NOT NULL DEFAULT 0.72
    CHECK (watermark_opacity >= 0.1 AND watermark_opacity <= 1),
  watermark_scale TEXT NOT NULL DEFAULT 'medium'
    CHECK (watermark_scale IN ('small','medium','large')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT INTO workspace_settings_new (
  workspace_id, watermark_enabled, watermark_text, watermark_position,
  watermark_opacity, watermark_scale, updated_at
)
SELECT
  workspace_id, watermark_enabled, watermark_text, watermark_position,
  watermark_opacity, watermark_scale, updated_at
FROM workspace_settings;

DROP TABLE workspace_settings;
ALTER TABLE workspace_settings_new RENAME TO workspace_settings;

PRAGMA foreign_keys = ON;
