-- Add workspace_id to skill_actions and backfill from skills

ALTER TABLE "skill_actions"
ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

UPDATE "skill_actions" sa
SET "workspace_id" = s."workspace_id"
FROM "skills" s
WHERE sa."workspace_id" IS NULL
  AND s."id" = sa."skill_id";

DO $$
BEGIN
  ALTER TABLE "skill_actions"
  ADD CONSTRAINT "skill_actions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

ALTER TABLE "skill_actions"
ALTER COLUMN "workspace_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "skill_actions_workspace_idx" ON "skill_actions" ("workspace_id");
