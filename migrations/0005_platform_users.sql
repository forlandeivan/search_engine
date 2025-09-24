ALTER TABLE "users" RENAME COLUMN "username" TO "email";
ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique";
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" text;
UPDATE "users" SET "full_name" = COALESCE("full_name", 'Новый пользователь');
ALTER TABLE "users" ALTER COLUMN "full_name" SET DEFAULT 'Новый пользователь';
ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP;
UPDATE "users" SET
  "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
  "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP);
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "owner_id" varchar;

WITH upsert_user AS (
  INSERT INTO "users" ("email", "full_name", "password_hash")
  VALUES ('forlandeivan@gmail.com', 'Иван Фролов', '$2b$12$fYPpL/EqGB.IykWRGbSN3uYJQYNmD4fj7UncIr6zV2zMCemnbj6kC')
  ON CONFLICT ("email") DO UPDATE
    SET
      "full_name" = EXCLUDED."full_name",
      "password_hash" = EXCLUDED."password_hash",
      "updated_at" = CURRENT_TIMESTAMP
  RETURNING id
)
UPDATE "sites"
SET "owner_id" = (SELECT id FROM upsert_user)
WHERE "owner_id" IS NULL;

ALTER TABLE "sites"
  ALTER COLUMN "owner_id" SET NOT NULL;

ALTER TABLE "sites"
  ADD CONSTRAINT IF NOT EXISTS "sites_owner_id_users_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade;

ALTER TABLE "users" ALTER COLUMN "full_name" DROP DEFAULT;
