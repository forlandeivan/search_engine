CREATE TABLE IF NOT EXISTS knowledge_base_indexing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type text NOT NULL DEFAULT 'knowledge_base_indexing',
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    base_id varchar NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id varchar NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    version_id varchar NOT NULL REFERENCES knowledge_document_versions(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    next_retry_at timestamp,
    last_error text,
    chunk_count integer,
    total_chars integer,
    total_tokens integer,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_unique_job_idx 
    ON knowledge_base_indexing_jobs(job_type, document_id, version_id);

CREATE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_workspace_idx 
    ON knowledge_base_indexing_jobs(workspace_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_base_idx 
    ON knowledge_base_indexing_jobs(base_id, status, next_retry_at);

