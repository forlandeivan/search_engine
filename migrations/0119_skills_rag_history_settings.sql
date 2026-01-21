-- Добавление полей для настройки истории диалога в RAG-навыках
ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "rag_history_messages_limit" integer DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "rag_history_chars_limit" integer DEFAULT 4000;

-- Обновление существующих записей значениями по умолчанию
UPDATE "skills"
SET
  "rag_history_messages_limit" = COALESCE("rag_history_messages_limit", 6),
  "rag_history_chars_limit" = COALESCE("rag_history_chars_limit", 4000);
