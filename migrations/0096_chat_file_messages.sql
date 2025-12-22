ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'text';

CREATE TABLE IF NOT EXISTS chat_attachments (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chat_id varchar NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id varchar REFERENCES chat_messages(id) ON DELETE SET NULL,
    uploader_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    filename text NOT NULL,
    mime_type text,
    size_bytes bigint,
    storage_key text NOT NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_attachments_workspace_idx ON chat_attachments (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS chat_attachments_chat_idx ON chat_attachments (chat_id, created_at);
CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON chat_attachments (message_id);
