CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('analyze_source','discover_clips','render_clip')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','running','succeeded','failed','cancelled')),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until TEXT,
  locked_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (source_video_id) REFERENCES source_videos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_queue ON processing_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_workspace ON processing_jobs(workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_jobs_active_source ON processing_jobs(workspace_id, source_video_id, job_type) WHERE status IN ('queued','claimed','running');