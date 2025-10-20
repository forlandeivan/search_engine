CREATE EXTENSION IF NOT EXISTS ltree;

ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "slug" text NOT NULL DEFAULT '';

UPDATE "knowledge_nodes"
SET "slug" = "id"
WHERE ("slug" IS NULL OR trim("slug") = '')
  AND "id" IS NOT NULL;

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "slug" SET DEFAULT '';

ALTER TABLE "knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "path" ltree;

WITH RECURSIVE normalized_nodes AS (
  SELECT
    kn."id",
    kn."parent_id",
    kn."base_id",
    CASE
      WHEN coalesce(nullif(kn."slug", ''), '') <> '' THEN kn."slug"
      ELSE replace(kn."id", '-', '_')
    END AS raw_segment
  FROM "knowledge_nodes" AS kn
),
processed_nodes AS (
  SELECT
    nn."id",
    nn."parent_id",
    nn."base_id",
    CASE
      WHEN segment_value = '' THEN CONCAT('node_', substring(replace(nn."id", '-', '_') FROM 1 FOR 24))
      WHEN segment_value ~ '^[a-z]' THEN segment_value
      ELSE CONCAT('n_', segment_value)
    END AS segment
  FROM (
    SELECT
      nn."id",
      nn."parent_id",
      nn."base_id",
      regexp_replace(
        regexp_replace(lower(nn.raw_segment), '[^a-z0-9_]+', '_', 'g'),
        '^_+|_+$',
        '',
        'g'
      ) AS segment_value
    FROM normalized_nodes AS nn
  ) AS cleaned
),
computed_paths AS (
  SELECT
    pn."id",
    pn."parent_id",
    pn."base_id",
    text2ltree(pn.segment) AS computed_path
  FROM processed_nodes AS pn
  WHERE pn."parent_id" IS NULL

  UNION ALL

  SELECT
    child."id",
    child."parent_id",
    child."base_id",
    parent.computed_path || text2ltree(child.segment) AS computed_path
  FROM processed_nodes AS child
  JOIN computed_paths AS parent ON child."parent_id" = parent."id"
)
UPDATE "knowledge_nodes" AS kn
SET "path" = cp.computed_path
FROM computed_paths AS cp
WHERE kn."id" = cp."id"
  AND (kn."path" IS NULL OR nlevel(kn."path") = 0);

UPDATE "knowledge_nodes"
SET "path" = text2ltree(
    CASE
      WHEN coalesce(nullif("slug", ''), '') <> '' THEN
        CASE
          WHEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g') ~ '^[a-z]'
            THEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
          ELSE 'n_' || regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
        END
      ELSE 'node_' || substring(replace("id", '-', '_') FROM 1 FOR 24)
    END
  )
WHERE "path" IS NULL;

ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "path" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_base_slug_idx
  ON "knowledge_nodes"("base_id", "slug");

CREATE INDEX IF NOT EXISTS knowledge_nodes_base_parent_position_idx
  ON "knowledge_nodes"("base_id", "parent_id", "position");

CREATE INDEX IF NOT EXISTS knowledge_nodes_path_gin
  ON "knowledge_nodes" USING GIN ("path");

CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "node_id" varchar NOT NULL UNIQUE REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
  "current_version_id" varchar,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_documents_workspace_idx
  ON "knowledge_documents"("workspace_id");

CREATE INDEX IF NOT EXISTS knowledge_documents_base_idx
  ON "knowledge_documents"("base_id");

CREATE TABLE IF NOT EXISTS "knowledge_document_versions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" varchar NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "version_no" integer NOT NULL,
  "author_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "content_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "content_text" text NOT NULL DEFAULT '',
  "hash" text,
  "word_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_versions_document_version_idx
  ON "knowledge_document_versions"("document_id", "version_no");

CREATE INDEX IF NOT EXISTS knowledge_document_versions_document_created_idx
  ON "knowledge_document_versions"("document_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS knowledge_document_versions_workspace_idx
  ON "knowledge_document_versions"("workspace_id");

WITH inserted_documents AS (
  INSERT INTO "knowledge_documents" ("base_id", "workspace_id", "node_id", "status", "created_at", "updated_at")
  SELECT
    kn."base_id",
    kn."workspace_id",
    kn."id",
    'published',
    kn."created_at",
    kn."updated_at"
  FROM "knowledge_nodes" AS kn
  WHERE kn."type" = 'document'
    AND NOT EXISTS (
      SELECT 1
      FROM "knowledge_documents" AS kd
      WHERE kd."node_id" = kn."id"
    )
  RETURNING "id", "node_id", "workspace_id", "created_at", "updated_at"
),
created_versions AS (
  INSERT INTO "knowledge_document_versions" (
    "document_id",
    "workspace_id",
    "version_no",
    "author_id",
    "content_json",
    "content_text",
    "hash",
    "word_count",
    "created_at"
  )
  SELECT
    id_map."id",
    id_map."workspace_id",
    1,
    NULL,
    '{}'::jsonb,
    COALESCE(kn."content", ''),
    CASE
      WHEN COALESCE(kn."content", '') = '' THEN NULL
      ELSE md5(kn."content")
    END,
    CASE
      WHEN COALESCE(trim(kn."content"), '') = '' THEN 0
      ELSE array_length(regexp_split_to_array(trim(kn."content"), '\\s+'), 1)
    END,
    COALESCE(kn."updated_at", CURRENT_TIMESTAMP)
  FROM inserted_documents AS id_map
  JOIN "knowledge_nodes" AS kn ON kn."id" = id_map."node_id"
  RETURNING "id", "document_id"
)
UPDATE "knowledge_documents" AS kd
SET "current_version_id" = cv."id"
FROM created_versions AS cv
WHERE kd."id" = cv."document_id"
  AND kd."current_version_id" IS NULL;

UPDATE "knowledge_nodes"
SET "content" = NULL
WHERE "type" = 'document' AND "content" IS NOT NULL;

ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT IF NOT EXISTS knowledge_documents_current_version_fkey
  FOREIGN KEY ("current_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL;
