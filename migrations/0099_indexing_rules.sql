CREATE TABLE IF NOT EXISTS indexing_rules (
    id varchar PRIMARY KEY DEFAULT 'indexing_rules_singleton',
    embeddings_provider varchar(255) NOT NULL,
    embeddings_model varchar(255) NOT NULL,
    chunk_size integer NOT NULL,
    chunk_overlap integer NOT NULL,
    top_k integer NOT NULL,
    relevance_threshold double precision NOT NULL,
    citations_enabled boolean NOT NULL DEFAULT false,
    updated_by_admin_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT indexing_rules_chunk_overlap_check CHECK (chunk_overlap >= 0 AND chunk_overlap < chunk_size),
    CONSTRAINT indexing_rules_top_k_check CHECK (top_k > 0),
    CONSTRAINT indexing_rules_chunk_size_check CHECK (chunk_size > 0),
    CONSTRAINT indexing_rules_relevance_threshold_check CHECK (relevance_threshold >= 0 AND relevance_threshold <= 1)
);
