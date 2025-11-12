CREATE TABLE IF NOT EXISTS "knowledge_base_rag_requests" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "top_k" integer,
  "bm25_weight" double precision,
  "bm25_limit" integer,
  "vector_weight" double precision,
  "vector_limit" integer,
  "embedding_provider_id" varchar REFERENCES "embedding_providers"("id") ON DELETE SET NULL,
  "collection" text,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS knowledge_base_rag_requests_workspace_base_created_idx
  ON "knowledge_base_rag_requests" ("workspace_id", "knowledge_base_id", "created_at");
