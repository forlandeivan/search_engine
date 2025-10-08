WITH target_user AS (
  SELECT id
  FROM "users"
  WHERE email = 'forlandeivan@gmail.com'
  LIMIT 1
),
workspace_by_owner AS (
  SELECT w.id, w.owner_id, w.created_at
  FROM "workspaces" w
  JOIN target_user tu ON w.owner_id = tu.id
  ORDER BY w.created_at
  LIMIT 1
),
workspace_by_name AS (
  SELECT w.id, w.owner_id, w.created_at
  FROM "workspaces" w
  JOIN target_user tu ON w.owner_id = tu.id
  WHERE w.name = 'forlandeivan'
  ORDER BY w.created_at
  LIMIT 1
),
ensured_workspace AS (
  SELECT id, owner_id FROM workspace_by_owner
  UNION ALL
  SELECT id, owner_id FROM workspace_by_name
  LIMIT 1
),
created_workspace AS (
  INSERT INTO "workspaces" ("name", "owner_id")
  SELECT 'forlandeivan', tu.id
  FROM target_user tu
  WHERE NOT EXISTS (SELECT 1 FROM ensured_workspace)
  RETURNING id, owner_id
),
final_workspace AS (
  SELECT id, owner_id FROM ensured_workspace
  UNION ALL
  SELECT id, owner_id FROM created_workspace
  LIMIT 1
)
UPDATE "workspaces" w
SET "name" = 'forlandeivan',
    "updated_at" = CURRENT_TIMESTAMP
FROM final_workspace fw
WHERE w.id = fw.id
  AND w.name <> 'forlandeivan';

WITH target_user AS (
  SELECT id
  FROM "users"
  WHERE email = 'forlandeivan@gmail.com'
  LIMIT 1
),
final_workspace AS (
  SELECT w.id, w.owner_id
  FROM "workspaces" w
  JOIN target_user tu ON w.owner_id = tu.id
  WHERE w.name = 'forlandeivan'
  ORDER BY w.created_at
  LIMIT 1
)
UPDATE "sites" s
SET "workspace_id" = fw.id,
    "updated_at" = CURRENT_TIMESTAMP
FROM final_workspace fw,
     target_user tu
WHERE s.owner_id = tu.id
  AND s.workspace_id <> fw.id;

WITH target_user AS (
  SELECT id
  FROM "users"
  WHERE email = 'forlandeivan@gmail.com'
  LIMIT 1
),
final_workspace AS (
  SELECT w.id
  FROM "workspaces" w
  JOIN target_user tu ON w.owner_id = tu.id
  WHERE w.name = 'forlandeivan'
  ORDER BY w.created_at
  LIMIT 1
)
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
SELECT fw.id, tu.id, 'owner'
FROM final_workspace fw,
     target_user tu
ON CONFLICT ("workspace_id", "user_id") DO UPDATE
SET "role" = EXCLUDED."role",
    "updated_at" = CURRENT_TIMESTAMP;
