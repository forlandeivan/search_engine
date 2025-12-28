ALTER TABLE "skill_files"
  ADD COLUMN IF NOT EXISTS "file_id" uuid REFERENCES "files"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS skill_files_file_idx ON "skill_files" ("file_id");
