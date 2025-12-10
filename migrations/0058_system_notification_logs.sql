CREATE TABLE IF NOT EXISTS system_notification_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz NULL,
    type varchar(255) NOT NULL,
    to_email varchar(255) NOT NULL,
    subject varchar(255) NOT NULL,
    body_preview varchar(500) NULL,
    body text NULL,
    status varchar(255) NOT NULL DEFAULT 'queued',
    error_message text NULL,
    smtp_response text NULL,
    correlation_id varchar(255) NULL,
    triggered_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS system_notification_logs_created_at_idx ON system_notification_logs (created_at);
CREATE INDEX IF NOT EXISTS system_notification_logs_to_email_idx ON system_notification_logs (to_email);
CREATE INDEX IF NOT EXISTS system_notification_logs_type_idx ON system_notification_logs (type);
CREATE INDEX IF NOT EXISTS system_notification_logs_status_idx ON system_notification_logs (status);
