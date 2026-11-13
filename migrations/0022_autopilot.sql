-- Original-content autopilot for the connected YouTube workspace.
CREATE TABLE IF NOT EXISTS autopilot_settings (
  workspace_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  daily_target INTEGER NOT NULL DEFAULT 3 CHECK (daily_target BETWEEN 1 AND 5),
  voice_language TEXT NOT NULL DEFAULT 'en',
  subtitle_language TEXT NOT NULL DEFAULT 'id',
  privacy_status TEXT NOT NULL DEFAULT 'public' CHECK (privacy_status IN ('private','unlisted','public')),
  watermark_enabled INTEGER NOT NULL DEFAULT 1 CHECK (watermark_enabled IN (0,1)),
  watermark_text TEXT NOT NULL DEFAULT '@Clippers2K26',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  last_report_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS autopilot_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','generating','generating_scenes','render_queued','rendering','queued_publish','published','failed','skipped')),
  niche TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  voice_language TEXT NOT NULL DEFAULT 'en',
  subtitle_language TEXT NOT NULL DEFAULT 'id',
  script_json TEXT NOT NULL DEFAULT '{}',
  sources_json TEXT NOT NULL DEFAULT '[]',
  audio_key TEXT,
  scenes_json TEXT NOT NULL DEFAULT '[]',
  next_scene_number INTEGER NOT NULL DEFAULT 1,
  duration_seconds REAL NOT NULL DEFAULT 45,
  runner_id TEXT,
  locked_until TEXT,
  output_key TEXT,
  output_size_bytes INTEGER,
  clip_id TEXT,
  publishing_job_id TEXT,
  platform_video_id TEXT,
  platform_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_autopilot_queue
  ON autopilot_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_autopilot_workspace_day
  ON autopilot_jobs(workspace_id, day_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_unique_title_per_day
  ON autopilot_jobs(workspace_id, day_key, title)
  WHERE title <> '';

CREATE TABLE IF NOT EXISTS autopilot_daily_reports (
  workspace_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  produced_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, report_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
