CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "knowledge_document_chunks"
  ADD COLUMN IF NOT EXISTS "content_hash" text;

UPDATE "knowledge_document_chunks"
SET "content_hash" = encode(digest(COALESCE("text", ''), 'sha256'), 'hex')
WHERE "content_hash" IS NULL;

ALTER TABLE "knowledge_document_chunks"
  ALTER COLUMN "content_hash" SET NOT NULL;
