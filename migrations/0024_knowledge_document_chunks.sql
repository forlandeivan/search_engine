CREATE TABLE IF NOT EXISTS "knowledge_document_chunk_sets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" varchar NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "version_id" varchar NOT NULL REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE,
  "document_hash" text,
  "max_tokens" integer,
  "max_chars" integer,
  "overlap_tokens" integer,
  "overlap_chars" integer,
  "split_by_pages" boolean NOT NULL DEFAULT false,
  "respect_headings" boolean NOT NULL DEFAULT true,
  "chunk_count" integer NOT NULL DEFAULT 0,
  "total_tokens" integer NOT NULL DEFAULT 0,
  "total_chars" integer NOT NULL DEFAULT 0,
  "is_latest" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_idx
  ON "knowledge_document_chunk_sets" ("document_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_latest_idx
  ON "knowledge_document_chunk_sets" ("document_id", "is_latest");

CREATE TABLE IF NOT EXISTS "knowledge_document_chunks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "chunk_set_id" varchar NOT NULL REFERENCES "knowledge_document_chunk_sets"("id") ON DELETE CASCADE,
  "document_id" varchar NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "version_id" varchar NOT NULL REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "text" text NOT NULL,
  "char_start" integer NOT NULL,
  "char_end" integer NOT NULL,
  "token_count" integer NOT NULL,
  "page_number" integer,
  "section_path" text[],
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "content_hash" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_set_index_idx
  ON "knowledge_document_chunks" ("chunk_set_id", "chunk_index");

CREATE INDEX IF NOT EXISTS knowledge_document_chunks_document_idx
  ON "knowledge_document_chunks" ("document_id", "chunk_index");
