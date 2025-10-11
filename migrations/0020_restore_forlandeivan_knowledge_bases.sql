WITH target_user AS (
  SELECT id
  FROM "users"
  WHERE email = 'forlandeivan@gmail.com'
  LIMIT 1
),
final_workspace AS (
  SELECT w.id
  FROM "workspaces" w
  JOIN target_user tu ON tu.id = w.owner_id
  WHERE w.name = 'forlandeivan'
  ORDER BY w.created_at
  LIMIT 1
),
base_data AS (
  SELECT *
  FROM (
    VALUES
      (
        'Акти ПГТК',
        'Документы с регламентами и актами по проектам ПГТК.',
        '2024-04-15 10:00:00',
        '2024-05-10 15:30:00'
      ),
      (
        'Грант FASIE Hopper 2024',
        'Импорт из архива с материалами заявки на грант Hopper 2024.',
        '2024-02-20 09:00:00',
        '2024-03-01 18:45:00'
      ),
      (
        'пустая база',
        'Черновик для новых структур и экспериментов.',
        '2024-01-10 12:00:00',
        '2024-01-10 12:00:00'
      )
  ) AS t(name, description, created_at, updated_at)
),
inserted_bases AS (
  INSERT INTO "knowledge_bases" (workspace_id, name, description, created_at, updated_at)
  SELECT fw.id, bd.name, bd.description, bd.created_at::timestamp, bd.updated_at::timestamp
  FROM final_workspace fw
  CROSS JOIN base_data bd
  WHERE NOT EXISTS (
    SELECT 1
    FROM "knowledge_bases" kb
    WHERE kb.workspace_id = fw.id
      AND kb.name = bd.name
  )
  RETURNING id, name, workspace_id
),
relevant_bases AS (
  SELECT id, name, workspace_id
  FROM inserted_bases

  UNION

  SELECT kb.id, kb.name, kb.workspace_id
  FROM "knowledge_bases" kb
  JOIN final_workspace fw ON fw.id = kb.workspace_id
  WHERE kb.name IN (SELECT name FROM base_data)
),
node_data AS (
  SELECT *
  FROM (
    VALUES
      (
        'Акти ПГТК',
        NULL::text,
        'Перечень утверждённых актов',
        'document',
        'Свод действующих актов ПГТК с реквизитами, сроками действия и ответственными.',
        0,
        '2024-05-09 14:15:00',
        '2024-05-10 15:30:00'
      )
  ) AS t(base_name, parent_title, title, type, content, position, created_at, updated_at)
)
INSERT INTO "knowledge_nodes" (id, base_id, parent_id, title, type, content, position, created_at, updated_at)
SELECT
  gen_random_uuid(),
  rb.id,
  NULL,
  nd.title,
  nd.type,
  nd.content,
  nd.position,
  nd.created_at::timestamp,
  nd.updated_at::timestamp
FROM node_data nd
JOIN relevant_bases rb ON rb.name = nd.base_name
WHERE NOT EXISTS (
  SELECT 1
  FROM "knowledge_nodes" existing
  WHERE existing.base_id = rb.id
    AND existing.title = nd.title
    AND existing.parent_id IS NULL
);

UPDATE "knowledge_bases" kb
SET updated_at = GREATEST(kb.updated_at, CURRENT_TIMESTAMP)
WHERE kb.id IN (SELECT id FROM relevant_bases);
