ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_name" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_name" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "phone" text DEFAULT '' NOT NULL,
  ADD COLUMN IF NOT EXISTS "personal_api_token_hash" text,
  ADD COLUMN IF NOT EXISTS "personal_api_token_last_four" text,
  ADD COLUMN IF NOT EXISTS "personal_api_token_generated_at" timestamp;

UPDATE "users"
SET
  "first_name" = CASE
    WHEN COALESCE(NULLIF(btrim("first_name"), ''), '') <> '' THEN btrim("first_name")
    WHEN position(' ' in "full_name") > 0 THEN split_part("full_name", ' ', 1)
    ELSE "full_name"
  END,
  "last_name" = CASE
    WHEN COALESCE(NULLIF(btrim("last_name"), ''), '') <> '' THEN btrim("last_name")
    WHEN position(' ' in "full_name") > 0 THEN btrim(substring("full_name" from position(' ' in "full_name") + 1))
    ELSE ''
  END,
  "phone" = COALESCE("phone", '');

ALTER TABLE "users"
  ALTER COLUMN "first_name" SET DEFAULT '',
  ALTER COLUMN "last_name" SET DEFAULT '',
  ALTER COLUMN "phone" SET DEFAULT '',
  ALTER COLUMN "first_name" SET NOT NULL,
  ALTER COLUMN "last_name" SET NOT NULL,
  ALTER COLUMN "phone" SET NOT NULL;
