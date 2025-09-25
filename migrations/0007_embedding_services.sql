CREATE TABLE IF NOT EXISTS "embedding_providers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "provider_type" text NOT NULL DEFAULT 'gigachat',
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "token_url" text NOT NULL,
  "embeddings_url" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret" text NOT NULL,
  "scope" text NOT NULL,
  "model" text NOT NULL,
  "request_headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "request_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "response_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "qdrant_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "embedding_providers_active_idx"
  ON "embedding_providers" ("is_active");

CREATE INDEX IF NOT EXISTS "embedding_providers_provider_type_idx"
  ON "embedding_providers" ("provider_type");
