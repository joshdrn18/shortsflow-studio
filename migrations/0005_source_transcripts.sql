CREATE TABLE IF NOT EXISTS source_transcripts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  language TEXT,
  model TEXT,
  transcript_text TEXT,
  segments_json TEXT NOT NULL DEFAULT '[]',
  audio_duration_seconds REAL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (source_video_id) REFERENCES source_videos(id) ON DELETE CASCADE,
  UNIQUE (source_video_id, version)
);

CREATE INDEX IF NOT EXISTS idx_source_transcripts_workspace
  ON source_transcripts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_transcripts_source
  ON source_transcripts(source_video_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_source_transcripts_status
  ON source_transcripts(status, updated_at);
