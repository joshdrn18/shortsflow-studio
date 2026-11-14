-- Content-only autopilot: save a complete publish-ready metadata package without enqueuing uploads.
ALTER TABLE clip_metadata ADD COLUMN platform_description TEXT NOT NULL DEFAULT '';
ALTER TABLE clip_metadata ADD COLUMN platform_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clip_metadata ADD COLUMN source_references_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE autopilot_jobs_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','generating','generating_scenes','render_queued','rendering','ready_to_publish','queued_publish','published','failed','skipped')),
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

INSERT INTO autopilot_jobs_new (
  id,workspace_id,day_key,status,niche,topic,title,hook,narration,voice_language,subtitle_language,
  script_json,sources_json,audio_key,scenes_json,next_scene_number,duration_seconds,runner_id,locked_until,
  output_key,output_size_bytes,clip_id,publishing_job_id,platform_video_id,platform_url,attempts,last_error,
  created_at,updated_at,published_at
)
SELECT
  id,workspace_id,day_key,status,niche,topic,title,hook,narration,voice_language,subtitle_language,
  script_json,sources_json,audio_key,scenes_json,next_scene_number,duration_seconds,runner_id,locked_until,
  output_key,output_size_bytes,clip_id,publishing_job_id,platform_video_id,platform_url,attempts,last_error,
  created_at,updated_at,published_at
FROM autopilot_jobs;

DROP TABLE autopilot_jobs;
ALTER TABLE autopilot_jobs_new RENAME TO autopilot_jobs;

CREATE INDEX IF NOT EXISTS idx_autopilot_queue ON autopilot_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_autopilot_workspace_day ON autopilot_jobs(workspace_id, day_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_autopilot_unique_title_per_day
  ON autopilot_jobs(workspace_id, day_key, title)
  WHERE title <> '';

-- Preserve any existing rendered autopilot content as drafts, and cancel its queued upload jobs.
UPDATE publishing_jobs
SET status='cancelled',
    last_error='Autopilot is configured for content generation only; upload was not started.',
    updated_at=datetime('now')
WHERE id IN (SELECT publishing_job_id FROM autopilot_jobs WHERE publishing_job_id IS NOT NULL)
  AND status IN ('queued','uploading');

UPDATE clips
SET status='rendered',updated_at=datetime('now')
WHERE id IN (SELECT clip_id FROM autopilot_jobs WHERE publishing_job_id IS NOT NULL)
  AND status='publishing';

UPDATE autopilot_jobs
SET status='ready_to_publish',publishing_job_id=NULL,updated_at=datetime('now')
WHERE status='queued_publish' AND output_key IS NOT NULL;
