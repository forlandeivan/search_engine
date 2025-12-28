ALTER TABLE "chat_attachments"
  ADD COLUMN IF NOT EXISTS "file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_attachments_file_idx ON "chat_attachments" ("file_id");
