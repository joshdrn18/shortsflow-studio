CREATE TABLE IF NOT EXISTS youtube_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  channel_thumbnail_url TEXT,
  refresh_token_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  access_token_expires_at TEXT,
  scopes TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS youtube_oauth_states (
  state_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
ALTER TABLE publishing_jobs ADD COLUMN render_asset_id TEXT;
ALTER TABLE publishing_jobs ADD COLUMN metadata_version INTEGER;
ALTER TABLE publishing_jobs ADD COLUMN title TEXT;
ALTER TABLE publishing_jobs ADD COLUMN description TEXT;
ALTER TABLE publishing_jobs ADD COLUMN privacy_status TEXT NOT NULL DEFAULT 'private';
ALTER TABLE publishing_jobs ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_publish_workspace_status ON publishing_jobs(status, scheduled_at);
