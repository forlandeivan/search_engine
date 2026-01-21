-- Добавление полей для настройки query rewriting в RAG-навыках
ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "rag_enable_query_rewriting" boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS "rag_query_rewrite_model" text;

-- Обновление существующих записей значениями по умолчанию
UPDATE "skills"
SET
  "rag_enable_query_rewriting" = COALESCE("rag_enable_query_rewriting", true);
