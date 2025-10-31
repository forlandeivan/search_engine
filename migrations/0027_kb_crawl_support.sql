-- Add new source type for knowledge nodes to support crawler documents
ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "source_config" jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_nodes_source_type_check'
  ) THEN
    ALTER TABLE "knowledge_nodes" DROP CONSTRAINT knowledge_nodes_source_type_check;
  END IF;
END $$;

ALTER TABLE "knowledge_nodes"
  ADD CONSTRAINT knowledge_nodes_source_type_check
  CHECK ("source_type" IN ('manual', 'import', 'crawl'));

-- Extend knowledge documents with crawling metadata
ALTER TABLE "knowledge_documents"
  ADD COLUMN IF NOT EXISTS "source_url" text,
  ADD COLUMN IF NOT EXISTS "content_hash" text,
  ADD COLUMN IF NOT EXISTS "language" text,
  ADD COLUMN IF NOT EXISTS "version_tag" text,
  ADD COLUMN IF NOT EXISTS "crawled_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'knowledge_documents_source_url_idx'
  ) THEN
    EXECUTE 'CREATE INDEX CONCURRENTLY knowledge_documents_source_url_idx ON "knowledge_documents" ("base_id", "source_url")';
  END IF;
END $$;
