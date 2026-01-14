CREATE TABLE IF NOT EXISTS knowledge_base_index_state (
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    base_id varchar NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'not_indexed',
    total_documents integer NOT NULL DEFAULT 0,
    outdated_documents integer NOT NULL DEFAULT 0,
    indexing_documents integer NOT NULL DEFAULT 0,
    error_documents integer NOT NULL DEFAULT 0,
    up_to_date_documents integer NOT NULL DEFAULT 0,
    policy_hash text,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, base_id)
);

CREATE INDEX IF NOT EXISTS knowledge_base_index_state_status_idx
    ON knowledge_base_index_state(workspace_id, status);
