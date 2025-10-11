ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

UPDATE "knowledge_nodes" AS kn
SET "workspace_id" = kb."workspace_id"
FROM "knowledge_bases" AS kb
WHERE kn."base_id" = kb."id" AND kn."workspace_id" IS NULL;

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "workspace_id" SET NOT NULL;

ALTER TABLE "knowledge_nodes"
  ADD CONSTRAINT IF NOT EXISTS "knowledge_nodes_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS knowledge_nodes_workspace_idx
  ON "knowledge_nodes" ("workspace_id");

CREATE INDEX IF NOT EXISTS knowledge_nodes_workspace_parent_idx
  ON "knowledge_nodes" ("workspace_id", "parent_id");
