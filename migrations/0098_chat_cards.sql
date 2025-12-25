-- Создаём таблицу карточек чата
CREATE TABLE IF NOT EXISTS chat_cards (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    chat_id varchar NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    type text NOT NULL,
    title text,
    preview_text text,
    transcript_id varchar,
    created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chat_cards_workspace_idx ON chat_cards (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS chat_cards_chat_idx ON chat_cards (chat_id, created_at);

-- Добавляем ссылку на карточку в сообщения
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS card_id varchar REFERENCES chat_cards(id) ON DELETE SET NULL;
