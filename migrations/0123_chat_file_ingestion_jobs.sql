-- Migration: chat_file_ingestion_jobs table
-- Description: Create table for background indexing of chat file attachments
-- Date: 2026-01-28

CREATE TABLE IF NOT EXISTS "chat_file_ingestion_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_type" text NOT NULL DEFAULT 'chat_file_ingestion',
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_id" varchar NOT NULL,
  "chat_id" varchar NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "attachment_id" varchar NOT NULL,
  "file_version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamp,
  "last_error" text,
  "chunk_count" integer,
  "total_chars" integer,
  "total_tokens" integer,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient job polling and querying
CREATE INDEX IF NOT EXISTS "chat_file_ingestion_jobs_status_idx" 
  ON "chat_file_ingestion_jobs" ("status", "next_retry_at");

CREATE INDEX IF NOT EXISTS "chat_file_ingestion_jobs_attachment_idx" 
  ON "chat_file_ingestion_jobs" ("attachment_id");

-- Unique constraint to prevent duplicate jobs for same attachment+version
CREATE UNIQUE INDEX IF NOT EXISTS "chat_file_ingestion_jobs_unique_idx" 
  ON "chat_file_ingestion_jobs" ("job_type", "attachment_id", "file_version");

COMMENT ON TABLE "chat_file_ingestion_jobs" IS 
  'Background jobs for indexing chat file attachments into vector store (Qdrant)';

COMMENT ON COLUMN "chat_file_ingestion_jobs"."status" IS 
  'Job status: pending | processing | done | error';
