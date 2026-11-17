-- Persist encrypted YouTube resumable upload sessions so interrupted transfers can be reconciled safely.
ALTER TABLE publishing_jobs ADD COLUMN youtube_upload_session_encrypted TEXT;
ALTER TABLE publishing_jobs ADD COLUMN youtube_upload_session_expires_at TEXT;
ALTER TABLE publishing_jobs ADD COLUMN youtube_upload_size INTEGER;
ALTER TABLE publishing_jobs ADD COLUMN youtube_upload_mime_type TEXT;
