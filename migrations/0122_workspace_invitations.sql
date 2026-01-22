-- Workspace Invitations: приглашения пользователей в рабочие пространства

CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" varchar(255) NOT NULL,
  "role" workspace_member_role NOT NULL DEFAULT 'user',
  "token" varchar(255) UNIQUE NOT NULL,
  "invited_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Индекс для быстрого поиска приглашений по workspace
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_idx" 
  ON "workspace_invitations" ("workspace_id");

-- Индекс для поиска приглашений по email
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_idx" 
  ON "workspace_invitations" ("email");

-- Индекс для очистки просроченных приглашений
CREATE INDEX IF NOT EXISTS "workspace_invitations_expires_idx" 
  ON "workspace_invitations" ("expires_at");

-- Составной индекс для поиска активных приглашений в workspace
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_pending_idx" 
  ON "workspace_invitations" ("workspace_id", "expires_at") 
  WHERE "accepted_at" IS NULL AND "cancelled_at" IS NULL;
