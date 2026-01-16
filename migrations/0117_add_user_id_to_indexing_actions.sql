-- Добавляем поле user_id в таблицу knowledge_base_indexing_actions
ALTER TABLE knowledge_base_indexing_actions
ADD COLUMN IF NOT EXISTS user_id varchar REFERENCES users(id) ON DELETE SET NULL;

-- Добавляем индекс для быстрого поиска по пользователю
CREATE INDEX IF NOT EXISTS knowledge_base_indexing_actions_user_idx
ON knowledge_base_indexing_actions(workspace_id, base_id, user_id);
