DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_event_status') THEN
        CREATE TYPE file_event_status AS ENUM ('queued', 'retrying', 'sent', 'failed');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS file_event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE,
    action TEXT NOT NULL,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL,
    skill_id UUID,
    chat_id UUID,
    user_id VARCHAR,
    message_id VARCHAR,
    target_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'none',
    bearer_token TEXT,
    payload JSONB NOT NULL,
    status file_event_status NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (file_id, action)
);

CREATE INDEX IF NOT EXISTS file_event_outbox_status_idx
  ON file_event_outbox (status, next_attempt_at NULLS FIRST, created_at);
