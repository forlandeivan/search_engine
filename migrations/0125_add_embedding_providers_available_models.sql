-- Migration: add available_models to embedding_providers
-- Description: Align embedding models with catalog selection
-- Date: 2026-01-30

ALTER TABLE "embedding_providers" 
ADD COLUMN IF NOT EXISTS "available_models" jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "embedding_providers"."available_models" IS 
  'List of available models for this provider, synchronized with the models catalog.';
