-- Canvas documents for transcript/canvas tabs
CREATE TABLE IF NOT EXISTS canvas_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chat_id varchar NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    transcript_id varchar REFERENCES transcripts(id) ON DELETE CASCADE,
    skill_id varchar REFERENCES skills(id) ON DELETE SET NULL,
    action_id varchar REFERENCES actions(id) ON DELETE SET NULL,
    type text NOT NULL DEFAULT 'derived',
    title text NOT NULL,
    content text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp
);

CREATE INDEX IF NOT EXISTS canvas_documents_workspace_idx ON canvas_documents(workspace_id);
CREATE INDEX IF NOT EXISTS canvas_documents_chat_idx ON canvas_documents(chat_id);
CREATE INDEX IF NOT EXISTS canvas_documents_transcript_idx ON canvas_documents(transcript_id);
CREATE INDEX IF NOT EXISTS canvas_documents_skill_idx ON canvas_documents(skill_id);
CREATE INDEX IF NOT EXISTS canvas_documents_action_idx ON canvas_documents(action_id);
