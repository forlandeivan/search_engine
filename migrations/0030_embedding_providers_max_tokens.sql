ALTER TABLE "embedding_providers"
  ADD COLUMN IF NOT EXISTS "max_tokens_per_vectorization" integer;
