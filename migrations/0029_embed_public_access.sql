CREATE TABLE IF NOT EXISTS "workspace_embed_keys" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "collection" text NOT NULL,
  "public_key" text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_embed_keys_workspace_collection_unique UNIQUE ("workspace_id", "collection")
);

CREATE TABLE IF NOT EXISTS "workspace_embed_key_domains" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "embed_key_id" varchar NOT NULL REFERENCES "workspace_embed_keys"("id") ON DELETE CASCADE,
  "domain" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_embed_key_domains_unique UNIQUE ("embed_key_id", "domain")
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_embed_key_domains_domain_idx
  ON "workspace_embed_key_domains" (lower("domain"));
