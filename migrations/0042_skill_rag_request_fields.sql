ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "rag_bm25_weight" double precision,
  ADD COLUMN IF NOT EXISTS "rag_bm25_limit" integer,
  ADD COLUMN IF NOT EXISTS "rag_vector_weight" double precision,
  ADD COLUMN IF NOT EXISTS "rag_vector_limit" integer,
  ADD COLUMN IF NOT EXISTS "rag_embedding_provider_id" varchar REFERENCES "embedding_providers"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "rag_llm_temperature" double precision,
  ADD COLUMN IF NOT EXISTS "rag_llm_max_tokens" integer,
  ADD COLUMN IF NOT EXISTS "rag_llm_response_format" text;
