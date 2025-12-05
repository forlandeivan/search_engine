-- Transcript views / versions per action
CREATE TABLE IF NOT EXISTS "transcript_views" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "transcript_id" varchar NOT NULL REFERENCES "transcripts"("id") ON DELETE CASCADE,
  "action_id" varchar,
  "label" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "transcript_views_transcript_idx" ON "transcript_views" ("transcript_id");

-- Preferred view for a transcript
ALTER TABLE "transcripts" ADD COLUMN IF NOT EXISTS "default_view_id" varchar;
CREATE INDEX IF NOT EXISTS "transcripts_default_view_idx" ON "transcripts" ("default_view_id");
