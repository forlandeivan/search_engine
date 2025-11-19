INSERT INTO "skills" (
  "workspace_id",
  "name",
  "is_system",
  "system_key",
  "rag_mode",
  "rag_collection_ids",
  "rag_top_k",
  "rag_min_score",
  "rag_max_context_tokens",
  "rag_show_sources"
)
SELECT
  w.id,
  'Unica Chat',
  true,
  'UNICA_CHAT',
  'all_collections',
  '[]'::jsonb,
  5,
  0.7,
  3000,
  true
FROM "workspaces" w
LEFT JOIN "skills" s
  ON s.workspace_id = w.id
  AND s.system_key = 'UNICA_CHAT'
WHERE s.id IS NULL;
