-- Migration: maintenance mode settings + audit log
-- Description: add maintenance mode settings singleton and audit log
-- Date: 2026-01-30

CREATE TABLE IF NOT EXISTS maintenance_mode_settings (
    id varchar PRIMARY KEY DEFAULT 'maintenance_mode_singleton',
    scheduled_start_at timestamp NULL,
    scheduled_end_at timestamp NULL,
    force_enabled boolean NOT NULL DEFAULT false,
    message_title varchar(120) NOT NULL DEFAULT '',
    message_body text NOT NULL DEFAULT '',
    public_eta text NULL,
    updated_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS maintenance_mode_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type varchar(64) NOT NULL,
    actor_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    occurred_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS maintenance_mode_audit_log_occurred_at_idx
    ON maintenance_mode_audit_log (occurred_at);
CREATE INDEX IF NOT EXISTS maintenance_mode_audit_log_event_type_idx
    ON maintenance_mode_audit_log (event_type);
