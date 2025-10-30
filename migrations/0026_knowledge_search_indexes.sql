CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "knowledge_document_chunks"
  ADD COLUMN IF NOT EXISTS "text_tsv" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', COALESCE("metadata"->>'heading', '')), 'A') ||
      setweight(to_tsvector('russian', COALESCE("metadata"->>'firstSentence', '')), 'B') ||
      setweight(to_tsvector('russian', COALESCE("text", '')), 'C')
    ) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_document_chunks_text_tsv_idx
  ON "knowledge_document_chunks"
  USING GIN ("text_tsv");

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_document_chunks_heading_trgm_idx
  ON "knowledge_document_chunks"
  USING GIN (("metadata"->>'heading') gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_nodes_title_trgm_idx
  ON "knowledge_nodes"
  USING GIN ("title" gin_trgm_ops);
