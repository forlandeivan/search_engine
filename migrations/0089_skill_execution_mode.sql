-- Add execution mode to skills
ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "execution_mode" text;

UPDATE "skills"
SET "execution_mode" = 'standard'
WHERE "execution_mode" IS NULL;

ALTER TABLE "skills"
  ALTER COLUMN "execution_mode" SET DEFAULT 'standard';

ALTER TABLE "skills"
  ALTER COLUMN "execution_mode" SET NOT NULL;
