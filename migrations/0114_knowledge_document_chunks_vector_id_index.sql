DROP INDEX IF EXISTS knowledge_document_chunks_vector_id_idx;

CREATE INDEX IF NOT EXISTS knowledge_document_chunks_vector_id_idx
    ON knowledge_document_chunks(vector_id);
