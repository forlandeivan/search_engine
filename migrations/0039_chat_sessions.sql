CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "skill_id" varchar NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "title" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "chat_sessions_workspace_user_idx"
  ON "chat_sessions" ("workspace_id", "user_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "chat_id" varchar NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "chat_messages_chat_idx"
  ON "chat_messages" ("chat_id", "created_at");
