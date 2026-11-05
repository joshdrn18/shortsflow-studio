PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Studio workspace',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_videos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload','url')),
  source_url TEXT,
  storage_key TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploading','uploaded','analyzing','ready','failed','archived')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  title TEXT,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  hook TEXT,
  ai_score REAL,
  transcript TEXT,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','editing','rendering','rendered','in_review','approved','rejected','publishing','published','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (source_video_id) REFERENCES source_videos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_assets (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('render','thumbnail','subtitle','preview')),
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clip_metadata (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  caption TEXT,
  hashtags TEXT,
  language TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
  UNIQUE (clip_id, version)
);

CREATE TABLE IF NOT EXISTS clip_reviews (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  asset_version INTEGER NOT NULL,
  metadata_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','changes_requested')),
  notes TEXT,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'youtube',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','uploading','processing','published','failed','cancelled')),
  scheduled_at TEXT,
  platform_video_id TEXT,
  platform_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
  FOREIGN KEY (review_id) REFERENCES clip_reviews(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  event TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sources_workspace ON source_videos(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_workspace_status ON clips(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_clip ON clip_reviews(clip_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_status ON publishing_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_logs(workspace_id, created_at DESC);