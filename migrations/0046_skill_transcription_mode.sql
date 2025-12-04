-- Add transcription behavior settings to skills

ALTER TABLE "skills"
ADD COLUMN IF NOT EXISTS "on_transcription_mode" text NOT NULL DEFAULT 'raw_only';

ALTER TABLE "skills"
ADD COLUMN IF NOT EXISTS "on_transcription_auto_action_id" varchar;

CREATE INDEX IF NOT EXISTS "skills_on_transcription_action_idx"
  ON "skills" ("on_transcription_auto_action_id");
