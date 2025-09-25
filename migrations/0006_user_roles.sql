ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user';
UPDATE "users" SET "role" = COALESCE("role", 'user');
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP;
UPDATE "users" SET "last_active_at" = COALESCE("last_active_at", "updated_at", CURRENT_TIMESTAMP);
ALTER TABLE "users" ALTER COLUMN "last_active_at" SET NOT NULL;

UPDATE "users" SET "role" = 'admin' WHERE "email" = 'forlandeivan@gmail.com';
