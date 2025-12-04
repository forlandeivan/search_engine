-- Add default view/action link for transcripts

ALTER TABLE "transcripts"
ADD COLUMN IF NOT EXISTS "default_view_action_id" varchar;

CREATE INDEX IF NOT EXISTS "transcripts_default_view_action_idx"
  ON "transcripts" ("default_view_action_id");
