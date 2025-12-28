-- Единая таблица файлов с разделением типов хранения.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_kind') THEN
    CREATE TYPE file_kind AS ENUM ('attachment', 'audio', 'skill_doc');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_storage_type') THEN
    CREATE TYPE file_storage_type AS ENUM ('standard_minio', 'yandex_object_storage', 'external_provider');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_status') THEN
    CREATE TYPE file_status AS ENUM ('uploading', 'ready', 'failed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_id" varchar,
  "chat_id" varchar,
  "message_id" varchar,
  "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" file_kind NOT NULL,
  "name" text NOT NULL,
  "mime_type" text,
  "size_bytes" bigint,
  "storage_type" file_storage_type NOT NULL,
  "bucket" text,
  "object_key" text,
  "object_version" text,
  "external_uri" text,
  "provider_id" varchar REFERENCES "file_storage_providers"("id") ON DELETE SET NULL,
  "provider_file_id" text,
  "status" file_status NOT NULL DEFAULT 'ready',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS files_workspace_idx ON "files" ("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS files_skill_idx ON "files" ("skill_id");
CREATE INDEX IF NOT EXISTS files_chat_idx ON "files" ("chat_id");
CREATE INDEX IF NOT EXISTS files_message_idx ON "files" ("message_id");
