-- Idempotent per-attempt AI reservations. Triggers atomically enforce and
-- apply the daily budget even when multiple Workers reserve concurrently.
CREATE TABLE IF NOT EXISTS ai_usage_reservations (
  reservation_key TEXT PRIMARY KEY,
  usage_date TEXT NOT NULL,
  neurons REAL NOT NULL CHECK (neurons >= 0),
  audio_seconds INTEGER NOT NULL DEFAULT 0 CHECK (audio_seconds >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_reservations_date
  ON ai_usage_reservations(usage_date);
CREATE TRIGGER IF NOT EXISTS ai_usage_reservations_budget_guard
BEFORE INSERT ON ai_usage_reservations
BEGIN
  SELECT CASE
    WHEN COALESCE((SELECT neurons_reserved FROM ai_usage_daily WHERE usage_date = NEW.usage_date), 0) + NEW.neurons > 8000
    THEN RAISE(IGNORE)
  END;
END;
CREATE TRIGGER IF NOT EXISTS ai_usage_reservations_apply
AFTER INSERT ON ai_usage_reservations
BEGIN
  INSERT INTO ai_usage_daily (usage_date, neurons_reserved, audio_seconds_reserved, updated_at)
  VALUES (NEW.usage_date, NEW.neurons, NEW.audio_seconds, NEW.created_at)
  ON CONFLICT(usage_date) DO UPDATE SET
    neurons_reserved = neurons_reserved + NEW.neurons,
    audio_seconds_reserved = audio_seconds_reserved + NEW.audio_seconds,
    updated_at = NEW.created_at;
END;
