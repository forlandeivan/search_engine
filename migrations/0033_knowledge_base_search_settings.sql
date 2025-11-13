CREATE TABLE IF NOT EXISTS "knowledge_base_search_settings" (
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "chunk_settings" jsonb,
  "rag_settings" jsonb,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_base_search_settings_pk PRIMARY KEY ("workspace_id", "knowledge_base_id")
);
