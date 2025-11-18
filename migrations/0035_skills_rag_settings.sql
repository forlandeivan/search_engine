ALTER TABLE "skills"
  ADD COLUMN "rag_mode" text NOT NULL DEFAULT 'all_collections',
  ADD COLUMN "rag_collection_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "rag_top_k" integer NOT NULL DEFAULT 5,
  ADD COLUMN "rag_min_score" double precision NOT NULL DEFAULT 0.7,
  ADD COLUMN "rag_max_context_tokens" integer DEFAULT 3000,
  ADD COLUMN "rag_show_sources" boolean NOT NULL DEFAULT true;

UPDATE "skills"
SET
  "rag_mode" = COALESCE(NULLIF("rag_mode", ''), 'all_collections'),
  "rag_collection_ids" = COALESCE("rag_collection_ids", '[]'::jsonb),
  "rag_top_k" = COALESCE("rag_top_k", 5),
  "rag_min_score" = COALESCE("rag_min_score", 0.7),
  "rag_max_context_tokens" = COALESCE("rag_max_context_tokens", 3000),
  "rag_show_sources" = COALESCE("rag_show_sources", true);
