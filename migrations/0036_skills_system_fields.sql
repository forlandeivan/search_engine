ALTER TABLE "skills"
  ADD COLUMN "is_system" boolean NOT NULL DEFAULT false,
  ADD COLUMN "system_key" text;

UPDATE "skills"
SET
  "is_system" = COALESCE("is_system", false),
  "system_key" = NULL
WHERE "is_system" IS NULL;

CREATE UNIQUE INDEX "skills_workspace_system_key_unique_idx"
  ON "skills" ("workspace_id", "system_key");
