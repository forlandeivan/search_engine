ALTER TABLE "users"
  ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_id" text;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_avatar" text DEFAULT '';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "google_email_verified" boolean DEFAULT FALSE;

UPDATE "users"
SET
  "google_avatar" = COALESCE("google_avatar", ''),
  "google_email_verified" = COALESCE("google_email_verified", FALSE);

ALTER TABLE "users"
  ALTER COLUMN "google_avatar" SET DEFAULT '';

ALTER TABLE "users"
  ALTER COLUMN "google_avatar" SET NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "google_email_verified" SET DEFAULT FALSE;

ALTER TABLE "users"
  ALTER COLUMN "google_email_verified" SET NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT IF NOT EXISTS "users_google_id_unique" UNIQUE ("google_id");
