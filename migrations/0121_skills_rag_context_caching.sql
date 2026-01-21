-- Добавление полей для настройки кэширования контекста в RAG-навыках
ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "rag_enable_context_caching" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rag_context_cache_ttl_seconds" integer DEFAULT 300;

-- Обновление существующих записей значениями по умолчанию
UPDATE "skills"
SET
  "rag_enable_context_caching" = COALESCE("rag_enable_context_caching", false),
  "rag_context_cache_ttl_seconds" = COALESCE("rag_context_cache_ttl_seconds", 300);
