ALTER TABLE "pages"
ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE "pages"
ADD COLUMN IF NOT EXISTS "chunks" jsonb DEFAULT '[]'::jsonb NOT NULL;
