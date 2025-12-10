-- Add email confirmation fields and status to users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_email_confirmed" boolean DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "email_confirmed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "status" varchar(64) DEFAULT 'active';

-- Ensure full_name length constraint where applicable
-- (text type is unlimited; keep as-is if already using text)

-- Backfill existing users as confirmed/active
UPDATE "users"
SET
  is_email_confirmed = TRUE,
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  status = COALESCE(status, 'active')
WHERE is_email_confirmed IS DISTINCT FROM TRUE
   OR status IS NULL;

-- Recreate unique index for email if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexname = 'users_email_unique'
  ) THEN
    CREATE UNIQUE INDEX users_email_unique ON "users" ("email");
  END IF;
END $$;
