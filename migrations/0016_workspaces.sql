CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "owner_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan" text NOT NULL DEFAULT 'free',
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "workspace_members" (
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'user',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_members_pk PRIMARY KEY ("workspace_id", "user_id")
);

ALTER TABLE "sites"
  ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

ALTER TABLE "embedding_providers"
  ADD COLUMN IF NOT EXISTS "workspace_id" varchar;

WITH user_workspaces AS (
  INSERT INTO "workspaces" ("id", "name", "owner_id", "plan", "settings")
  SELECT
    gen_random_uuid(),
    COALESCE(NULLIF(split_part(u.email, '@', 1), ''), u.email, 'workspace'),
    u.id,
    'free',
    '{}'::jsonb
  FROM "users" u
  WHERE NOT EXISTS (
    SELECT 1 FROM "workspaces" w WHERE w.owner_id = u.id
  )
  RETURNING id, owner_id
)
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
SELECT uw.id, uw.owner_id, 'owner'
FROM user_workspaces uw
ON CONFLICT DO NOTHING;

INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
SELECT w.id, w.owner_id, 'owner'
FROM "workspaces" w
LEFT JOIN "workspace_members" wm
  ON wm.workspace_id = w.id AND wm.user_id = w.owner_id
WHERE wm.workspace_id IS NULL;

WITH owner_workspaces AS (
  SELECT w.id AS workspace_id, w.owner_id
  FROM "workspaces" w
)
UPDATE "sites" s
SET "workspace_id" = ow.workspace_id
FROM owner_workspaces ow
WHERE s.owner_id = ow.owner_id
  AND (s.workspace_id IS NULL OR s.workspace_id <> ow.workspace_id);

WITH admin_workspace AS (
  SELECT w.id
  FROM "workspace_members" wm
  JOIN "users" u ON u.id = wm.user_id
  JOIN "workspaces" w ON w.id = wm.workspace_id
  WHERE wm.role = 'owner' AND u.role = 'admin'
  ORDER BY w.created_at
  LIMIT 1
),
first_workspace AS (
  SELECT w.id
  FROM "workspaces" w
  ORDER BY w.created_at
  LIMIT 1
),
preferred_workspace AS (
  SELECT id FROM admin_workspace
  UNION ALL
  SELECT id FROM first_workspace
  LIMIT 1
)
UPDATE "embedding_providers" ep
SET "workspace_id" = pw.id
FROM preferred_workspace pw
WHERE ep.workspace_id IS NULL;

ALTER TABLE "sites"
  ALTER COLUMN "workspace_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "sites"
    ADD CONSTRAINT "sites_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "embedding_providers"
  ALTER COLUMN "workspace_id" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "embedding_providers"
    ADD CONSTRAINT "embedding_providers_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "sites_workspace_id_idx"
  ON "sites" ("workspace_id");

CREATE INDEX IF NOT EXISTS "embedding_providers_workspace_id_idx"
  ON "embedding_providers" ("workspace_id");
