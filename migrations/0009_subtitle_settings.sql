-- Versioned subtitle styling settings for each clip metadata snapshot.
ALTER TABLE clip_metadata ADD COLUMN subtitle_config_json TEXT NOT NULL DEFAULT '{}';
