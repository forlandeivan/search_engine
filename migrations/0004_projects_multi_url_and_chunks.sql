ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "name" text DEFAULT 'Новый проект';
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "start_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "max_chunk_size" integer NOT NULL DEFAULT 1200;

UPDATE "sites"
SET "name" = COALESCE(NULLIF("name", ''), CASE
  WHEN "url" IS NOT NULL AND "url" <> '' THEN 'Проект ' || split_part("url", '://', 2)
  ELSE 'Новый проект'
END);

UPDATE "sites"
SET "start_urls" = CASE
  WHEN jsonb_typeof("start_urls") = 'array' AND jsonb_array_length("start_urls") > 0 THEN "start_urls"
  WHEN "url" IS NOT NULL AND "url" <> '' THEN jsonb_build_array("url")
  ELSE '[]'::jsonb
END;

ALTER TABLE "sites" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "sites" ALTER COLUMN "name" SET DEFAULT 'Новый проект';
ALTER TABLE "sites" ALTER COLUMN "crawl_frequency" SET DEFAULT 'manual';
UPDATE "sites" SET "crawl_frequency" = 'manual';
