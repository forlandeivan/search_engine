ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "yandex_id" text;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "yandex_avatar" text DEFAULT '';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "yandex_email_verified" boolean DEFAULT FALSE;

UPDATE "users"
SET
  "yandex_avatar" = COALESCE("yandex_avatar", ''),
  "yandex_email_verified" = COALESCE("yandex_email_verified", FALSE);

ALTER TABLE "users"
  ALTER COLUMN "yandex_avatar" SET DEFAULT '';

ALTER TABLE "users"
  ALTER COLUMN "yandex_avatar" SET NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "yandex_email_verified" SET DEFAULT FALSE;

ALTER TABLE "users"
  ALTER COLUMN "yandex_email_verified" SET NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT IF NOT EXISTS "users_yandex_id_unique" UNIQUE ("yandex_id");
