ALTER TABLE clips ADD COLUMN discovery_job_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_discovery_job_time
  ON clips(discovery_job_id, start_seconds, end_seconds)
  WHERE discovery_job_id IS NOT NULL;
