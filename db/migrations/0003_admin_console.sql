-- MIVO V2.1 Trust & Safety / Admin Console extensions.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS moderation_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_warning_at text;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS assigned_moderator_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS updated_at text NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolution_code text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS internal_note text;

CREATE TABLE IF NOT EXISTS moderation_notes (
  id text PRIMARY KEY NOT NULL,
  target_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL,
  created_at text NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS moderation_appeals (
  id text PRIMARY KEY NOT NULL,
  public_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id text REFERENCES moderation_actions(id) ON DELETE SET NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  reviewed_by_id text REFERENCES users(id) ON DELETE SET NULL,
  decision_note text,
  created_at text NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  resolved_at text
);

CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_public_id_unique ON moderation_appeals(public_id);
CREATE INDEX IF NOT EXISTS moderation_appeals_status_idx ON moderation_appeals(status, created_at);
CREATE INDEX IF NOT EXISTS moderation_notes_target_idx ON moderation_notes(target_user_id, created_at);
CREATE INDEX IF NOT EXISTS users_status_suspend_idx ON users(status, suspended_until);
CREATE INDEX IF NOT EXISTS reports_assignee_idx ON reports(assigned_moderator_id, status, priority, created_at);

COMMIT;
