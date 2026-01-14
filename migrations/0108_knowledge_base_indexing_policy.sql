CREATE TABLE IF NOT EXISTS knowledge_base_indexing_policy (
    id varchar PRIMARY KEY DEFAULT 'kb_indexing_policy_singleton',
    embeddings_provider varchar(255) NOT NULL,
    embeddings_model varchar(255) NOT NULL,
    chunk_size integer NOT NULL,
    chunk_overlap integer NOT NULL,
    default_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_indexing_policy_chunk_overlap_check CHECK (chunk_overlap >= 0 AND chunk_overlap < chunk_size),
    CONSTRAINT kb_indexing_policy_chunk_size_check CHECK (chunk_size > 0)
);

