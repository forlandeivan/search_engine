DO $$
BEGIN
  CREATE TYPE "project_type" AS ENUM ('search_engine', 'vector_search');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "project_type" "project_type" NOT NULL DEFAULT 'search_engine';
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "vector_settings" jsonb NOT NULL DEFAULT '{"embeddingModel":"text-embedding-3-large","embeddingDimensions":3072,"chunkSize":512,"chunkOverlap":64}'::jsonb;

UPDATE "sites"
SET "project_type" = 'search_engine'
WHERE "project_type" IS NULL;
