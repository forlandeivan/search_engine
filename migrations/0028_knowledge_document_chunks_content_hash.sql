DO $$
DECLARE
  digest_missing boolean := false;
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'pgcrypto недоступен для текущей роли, пропускаем установку расширения';
    WHEN duplicate_object THEN
      NULL;
  END;

  EXECUTE 'ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "content_hash" text';

  BEGIN
    EXECUTE $$
      UPDATE "knowledge_document_chunks"
      SET "content_hash" = encode(digest(COALESCE("text", ''), 'sha256'), 'hex')
      WHERE "content_hash" IS NULL
    $$;
  EXCEPTION
    WHEN undefined_function THEN
      digest_missing := true;
      RAISE NOTICE 'Функция digest() недоступна, пропускаем SQL-бэкфилл content_hash';
    WHEN insufficient_privilege THEN
      digest_missing := true;
      RAISE NOTICE 'Нет прав на вызов digest(), пропускаем SQL-бэкфилл content_hash';
  END;

  IF digest_missing THEN
    RAISE NOTICE 'Колонка content_hash будет заполнена приложением';
  END IF;

  BEGIN
    EXECUTE 'ALTER TABLE "knowledge_document_chunks" ALTER COLUMN "content_hash" SET NOT NULL';
  EXCEPTION
    WHEN not_null_violation THEN
      RAISE NOTICE 'Колонка content_hash содержит NULL, оставляем nullable до бэкфилла';
    WHEN undefined_column THEN
      NULL;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Нет прав на изменение ограничения NOT NULL для content_hash, пропускаем';
  END;
END;
$$ LANGUAGE plpgsql;
