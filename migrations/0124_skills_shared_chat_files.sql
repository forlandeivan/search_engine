-- Migration: skills shared_chat_files field
-- Description: Add field for future "cross-pollination" of chat files across skill chats
-- Date: 2026-01-28

ALTER TABLE "skills" 
ADD COLUMN IF NOT EXISTS "shared_chat_files" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "skills"."shared_chat_files" IS 
  'If true, files from all chats of this skill are accessible in all chats (cross-pollination). Default: false (files isolated per chat).';
