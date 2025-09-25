ALTER TABLE "embedding_providers"
  ADD COLUMN IF NOT EXISTS "allow_self_signed" boolean DEFAULT false NOT NULL;
