ALTER TABLE "embedding_providers"
  ADD COLUMN IF NOT EXISTS "authorization_key" text DEFAULT '' NOT NULL;

ALTER TABLE "embedding_providers"
  DROP COLUMN IF EXISTS "client_id";

ALTER TABLE "embedding_providers"
  DROP COLUMN IF EXISTS "client_secret";
