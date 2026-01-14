CREATE TABLE IF NOT EXISTS knowledge_document_index_state (
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    base_id varchar NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id varchar NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    indexed_version_id varchar REFERENCES knowledge_document_versions(id) ON DELETE SET NULL,
    chunk_set_id varchar REFERENCES knowledge_document_chunk_sets(id) ON DELETE SET NULL,
    policy_hash text,
    status text NOT NULL DEFAULT 'not_indexed',
    error text,
    indexed_at timestamp,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (workspace_id, base_id, document_id)
);

CREATE INDEX IF NOT EXISTS knowledge_document_index_state_base_status_idx
    ON knowledge_document_index_state(base_id, status);

CREATE INDEX IF NOT EXISTS knowledge_document_index_state_workspace_base_idx
    ON knowledge_document_index_state(workspace_id, base_id);

CREATE INDEX IF NOT EXISTS knowledge_document_index_state_document_idx
    ON knowledge_document_index_state(document_id);
