CREATE TABLE IF NOT EXISTS ai_usage_daily (
  usage_date TEXT PRIMARY KEY,
  neurons_reserved REAL NOT NULL DEFAULT 0 CHECK (neurons_reserved >= 0),
  audio_seconds_reserved INTEGER NOT NULL DEFAULT 0 CHECK (audio_seconds_reserved >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
