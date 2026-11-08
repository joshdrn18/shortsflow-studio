CREATE TABLE IF NOT EXISTS youtube_video_metric_snapshots (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, publishing_job_id TEXT NOT NULL, video_id TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL,
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY (publishing_job_id) REFERENCES publishing_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_youtube_metrics_workspace_time ON youtube_video_metric_snapshots(workspace_id,fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_youtube_metrics_job_time ON youtube_video_metric_snapshots(publishing_job_id,fetched_at DESC);