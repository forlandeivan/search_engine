-- Migration: make workspace_id optional for providers
-- Description: Detach providers from specific workspaces
-- Date: 2026-01-30

ALTER TABLE "embedding_providers" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "llm_providers" ALTER COLUMN "workspace_id" DROP NOT NULL;

COMMENT ON COLUMN "embedding_providers"."workspace_id" IS 
  'Workspace that owns this provider. If NULL, it is a global system provider.';
COMMENT ON COLUMN "llm_providers"."workspace_id" IS 
  'Workspace that owns this provider. If NULL, it is a global system provider.';
