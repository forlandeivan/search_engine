DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS "workspace_vector_collections" (
    "collection_name" text PRIMARY KEY,
    "workspace_id" varchar NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
EXCEPTION
  WHEN duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "workspace_vector_collections"
    ADD CONSTRAINT "workspace_vector_collections_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "workspace_vector_collections_workspace_id_idx"
  ON "workspace_vector_collections" ("workspace_id");

WITH target_user AS (
  SELECT id
  FROM "users"
  WHERE email = 'forlandeivan@gmail.com'
  LIMIT 1
),
final_workspace AS (
  SELECT w.id
  FROM "workspaces" w
  JOIN target_user tu ON w.owner_id = tu.id
  WHERE w.name = 'forlandeivan'
  ORDER BY w.created_at
  LIMIT 1
),
collection_names AS (
  SELECT unnest(ARRAY[
    'test_final',
    'проверочная коллекция 23.09',
    'kb11111111111',
    'newcollection',
    'МОЭК',
    'newcollection222222222',
    'monq_docs',
    'fr_test'
  ]) AS collection_name
)
INSERT INTO "workspace_vector_collections" ("collection_name", "workspace_id")
SELECT cn.collection_name, fw.id
FROM collection_names cn
CROSS JOIN final_workspace fw
ON CONFLICT ("collection_name") DO UPDATE
SET "workspace_id" = EXCLUDED."workspace_id",
    "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "pages"
  ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

WITH page_workspaces AS (
  SELECT p.id, s.workspace_id
  FROM "pages" p
  JOIN "sites" s ON s.id = p.site_id
)
UPDATE "pages" p
SET "workspace_id" = pw.workspace_id,
    "updated_at" = CURRENT_TIMESTAMP
FROM page_workspaces pw
WHERE p.id = pw.id
  AND (p.workspace_id IS DISTINCT FROM pw.workspace_id);

ALTER TABLE "pages"
  ALTER COLUMN "workspace_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "pages"
    ADD CONSTRAINT "pages_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "pages_workspace_id_idx"
  ON "pages" ("workspace_id");

ALTER TABLE "search_index"
  ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

WITH search_workspaces AS (
  SELECT si.id, s.workspace_id
  FROM "search_index" si
  JOIN "pages" p ON p.id = si.page_id
  JOIN "sites" s ON s.id = p.site_id
)
UPDATE "search_index" si
SET "workspace_id" = sw.workspace_id
FROM search_workspaces sw
WHERE si.id = sw.id
  AND (si.workspace_id IS DISTINCT FROM sw.workspace_id);

ALTER TABLE "search_index"
  ALTER COLUMN "workspace_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "search_index"
    ADD CONSTRAINT "search_index_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "search_index_workspace_id_idx"
  ON "search_index" ("workspace_id");
