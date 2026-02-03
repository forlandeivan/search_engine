-- Migration: maintenance mode intervals
-- Description: extend schedules with messages + initiator, add force sessions table
-- Date: 2026-02-03

ALTER TABLE maintenance_mode_schedules
    ADD COLUMN IF NOT EXISTS created_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS message_title varchar(120) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS message_body text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS public_eta text NULL;

UPDATE maintenance_mode_schedules
SET created_by_admin_id = updated_by_admin_id
WHERE created_by_admin_id IS NULL
  AND updated_by_admin_id IS NOT NULL;

UPDATE maintenance_mode_schedules AS schedule
SET message_title = settings.message_title,
    message_body = settings.message_body,
    public_eta = settings.public_eta
FROM maintenance_mode_settings AS settings
WHERE settings.id = 'maintenance_mode_singleton'
  AND schedule.message_title = ''
  AND schedule.message_body = ''
  AND schedule.public_eta IS NULL;

CREATE TABLE IF NOT EXISTS maintenance_mode_force_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at timestamp NOT NULL,
    ended_at timestamp NULL,
    created_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    ended_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    message_title varchar(120) NOT NULL DEFAULT '',
    message_body text NOT NULL DEFAULT '',
    public_eta text NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS maintenance_mode_force_sessions_started_idx
    ON maintenance_mode_force_sessions (started_at);
CREATE INDEX IF NOT EXISTS maintenance_mode_force_sessions_ended_idx
    ON maintenance_mode_force_sessions (ended_at);
