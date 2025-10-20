ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "source_type" text;

UPDATE "knowledge_nodes"
SET "source_type" = 'manual'
WHERE "source_type" IS NULL OR TRIM("source_type") = '';

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "source_type" SET DEFAULT 'manual';

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "source_type" SET NOT NULL;

ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "import_file_name" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_nodes_source_type_check'
  ) THEN
    ALTER TABLE "knowledge_nodes"
      ADD CONSTRAINT knowledge_nodes_source_type_check
      CHECK ("source_type" IN ('manual', 'import'));
  END IF;
END $$;
