CREATE TABLE IF NOT EXISTS "personal_api_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "last_four" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" timestamp
);

CREATE INDEX IF NOT EXISTS "personal_api_tokens_user_id_idx" ON "personal_api_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "personal_api_tokens_active_idx" ON "personal_api_tokens" ("user_id") WHERE "revoked_at" IS NULL;

INSERT INTO "personal_api_tokens" ("user_id", "token_hash", "last_four", "created_at")
SELECT "id", "personal_api_token_hash", COALESCE("personal_api_token_last_four", ''),
       COALESCE("personal_api_token_generated_at", CURRENT_TIMESTAMP)
FROM "users"
WHERE COALESCE(NULLIF("personal_api_token_hash", ''), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "personal_api_tokens" existing
    WHERE existing."user_id" = "users"."id"
      AND existing."token_hash" = "users"."personal_api_token_hash"
  );
