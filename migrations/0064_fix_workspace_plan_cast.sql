-- Ensure workspaces.plan is cast to workspace_plan enum with explicit USING
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_plan') THEN
    CREATE TYPE workspace_plan AS ENUM ('free', 'team');
  END IF;
END $$;

ALTER TABLE "workspaces"
  ALTER COLUMN "plan" TYPE workspace_plan USING plan::workspace_plan;

-- Also align related columns to match Drizzle schema (explicit USING to silence db:push warnings)
ALTER TABLE "workspace_members"
  ALTER COLUMN "role" TYPE workspace_member_role USING role::workspace_member_role;

ALTER TABLE "users"
  ALTER COLUMN "email" TYPE varchar(255) USING email::varchar(255),
  ALTER COLUMN "full_name" TYPE varchar(255) USING full_name::varchar(255);
