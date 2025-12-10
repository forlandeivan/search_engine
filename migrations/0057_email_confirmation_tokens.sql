-- Email confirmation tokens
CREATE TABLE IF NOT EXISTS "email_confirmation_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" varchar NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_confirmation_tokens_user_idx ON "email_confirmation_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS email_confirmation_tokens_active_idx ON "email_confirmation_tokens" ("user_id", "expires_at") WHERE consumed_at IS NULL;
