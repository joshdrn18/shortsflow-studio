-- Global administrator identity is separate from workspace membership.
-- New registrations remain ordinary members even though they own their own workspace.
ALTER TABLE users
  ADD COLUMN system_role TEXT NOT NULL DEFAULT 'member'
  CHECK (system_role IN ('member', 'admin'));

-- Promote only the established ShortsFlow administrator account.
UPDATE users
SET system_role = 'admin',
    updated_at = datetime('now')
WHERE email = 'admnshortsflow@gmail.com' COLLATE NOCASE;
