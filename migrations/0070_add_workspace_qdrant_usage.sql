ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "qdrant_collections_count" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "qdrant_points_count" bigint NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "qdrant_storage_bytes" bigint NOT NULL DEFAULT 0;
