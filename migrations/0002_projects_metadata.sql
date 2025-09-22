ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT 'Новый проект';
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "sites" ALTER COLUMN "url" DROP NOT NULL;

UPDATE "sites"
SET "name" = COALESCE(NULLIF("name", ''), COALESCE("url", 'Новый проект'));
