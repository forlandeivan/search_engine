CREATE TABLE IF NOT EXISTS knowledge_document_index_revisions (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    base_id varchar NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id varchar NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    version_id varchar REFERENCES knowledge_document_versions(id) ON DELETE SET NULL,
    chunk_set_id varchar REFERENCES knowledge_document_chunk_sets(id) ON DELETE SET NULL,
    policy_hash text,
    status text NOT NULL DEFAULT 'processing',
    error text,
    started_at timestamp,
    finished_at timestamp,
    chunk_count integer NOT NULL DEFAULT 0,
    total_tokens integer NOT NULL DEFAULT 0,
    total_chars integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_document_idx
    ON knowledge_document_index_revisions(document_id, created_at);

CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_workspace_base_status_idx
    ON knowledge_document_index_revisions(workspace_id, base_id, status);

ALTER TABLE knowledge_documents
    ADD COLUMN IF NOT EXISTS current_revision_id varchar
    REFERENCES knowledge_document_index_revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS knowledge_documents_current_revision_idx
    ON knowledge_documents(current_revision_id);

ALTER TABLE knowledge_document_chunk_sets
    ADD COLUMN IF NOT EXISTS revision_id varchar
    REFERENCES knowledge_document_index_revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_revision_idx
    ON knowledge_document_chunk_sets(document_id, revision_id);

ALTER TABLE knowledge_document_chunks
    ADD COLUMN IF NOT EXISTS revision_id varchar
    REFERENCES knowledge_document_index_revisions(id) ON DELETE SET NULL;

ALTER TABLE knowledge_document_chunks
    ADD COLUMN IF NOT EXISTS vector_id text;

ALTER TABLE knowledge_document_chunks
    ADD COLUMN IF NOT EXISTS chunk_ordinal integer;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_vector_id_idx
    ON knowledge_document_chunks(vector_id);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_revision_hash_ordinal_idx
    ON knowledge_document_chunks(document_id, revision_id, content_hash, chunk_ordinal);

CREATE INDEX IF NOT EXISTS knowledge_document_chunks_document_revision_idx
    ON knowledge_document_chunks(document_id, revision_id);
