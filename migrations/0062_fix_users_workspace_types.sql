-- Sync auth/workspace types with code, without data loss
-- 1) Email confirmation fields (idempotent)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_email_confirmed" boolean DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "email_confirmed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "status" varchar(64) DEFAULT 'active';

UPDATE "users"
SET
  is_email_confirmed = TRUE,
  email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
  status = COALESCE(status, 'active')
WHERE is_email_confirmed IS DISTINCT FROM TRUE
   OR status IS NULL;

-- 2) Enums for workspace plan / member role (create if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_plan') THEN
    CREATE TYPE workspace_plan AS ENUM ('free', 'team');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_member_role') THEN
    CREATE TYPE workspace_member_role AS ENUM ('owner', 'manager', 'user');
  END IF;
END $$;

-- 3) Safe type casts (text -> varchar/enum)
ALTER TABLE "users"
  ALTER COLUMN "email" TYPE varchar(255) USING email::varchar(255),
  ALTER COLUMN "full_name" TYPE varchar(255) USING full_name::varchar(255);

ALTER TABLE "workspaces"
  ALTER COLUMN "plan" TYPE workspace_plan USING plan::workspace_plan;

ALTER TABLE "workspace_members"
  ALTER COLUMN "role" TYPE workspace_member_role USING role::workspace_member_role;
