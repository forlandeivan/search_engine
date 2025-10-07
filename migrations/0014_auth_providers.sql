CREATE TABLE IF NOT EXISTS "auth_providers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL UNIQUE,
  "is_enabled" boolean NOT NULL DEFAULT FALSE,
  "client_id" text NOT NULL DEFAULT '',
  "client_secret" text NOT NULL DEFAULT '',
  "callback_url" text NOT NULL DEFAULT '/api/auth/google/callback',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "auth_providers_provider_idx"
  ON "auth_providers" ("provider");
