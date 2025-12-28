ALTER TABLE "asr_executions"
  ADD COLUMN IF NOT EXISTS "file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS asr_executions_file_idx ON "asr_executions" ("file_id");
