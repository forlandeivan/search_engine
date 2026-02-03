-- Migration: maintenance mode schedules
-- Description: add schedule table for multiple maintenance windows
-- Date: 2026-02-03

CREATE TABLE IF NOT EXISTS maintenance_mode_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_start_at timestamp NOT NULL,
    scheduled_end_at timestamp NOT NULL,
    updated_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS maintenance_mode_schedules_start_idx
    ON maintenance_mode_schedules (scheduled_start_at);
CREATE INDEX IF NOT EXISTS maintenance_mode_schedules_end_idx
    ON maintenance_mode_schedules (scheduled_end_at);

-- Migrate existing singleton schedule (if any)
INSERT INTO maintenance_mode_schedules (scheduled_start_at, scheduled_end_at, updated_by_admin_id)
SELECT scheduled_start_at, scheduled_end_at, updated_by_admin_id
FROM maintenance_mode_settings
WHERE scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL;

UPDATE maintenance_mode_settings
SET scheduled_start_at = NULL,
    scheduled_end_at = NULL
WHERE scheduled_start_at IS NOT NULL OR scheduled_end_at IS NOT NULL;
