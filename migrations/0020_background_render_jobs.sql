CREATE TABLE IF NOT EXISTS clip_render_jobs (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 clip_id TEXT NOT NULL,
 source_video_id TEXT NOT NULL,
 metadata_version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 runner_id TEXT,
 locked_until TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 asset_id TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 completed_at TEXT,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE,
 FOREIGN KEY(source_video_id) REFERENCES source_videos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clip_render_jobs_queue ON clip_render_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS idx_clip_render_jobs_clip ON clip_render_jobs(clip_id,metadata_version,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_render_jobs_one_active
 ON clip_render_jobs(clip_id,metadata_version)
 WHERE status IN ('queued','running');
