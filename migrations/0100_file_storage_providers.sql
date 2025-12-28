-- Создаём реестр внешних файловых провайдеров и ссылку по умолчанию в workspace.

CREATE TABLE IF NOT EXISTS "file_storage_providers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "description" text,
  "auth_type" text NOT NULL DEFAULT 'none',
  "is_active" boolean NOT NULL DEFAULT TRUE,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT file_storage_providers_auth_type_chk CHECK ("auth_type" IN ('none', 'bearer'))
);

-- Простая защита от дублей по имени.
CREATE UNIQUE INDEX IF NOT EXISTS file_storage_providers_name_idx ON "file_storage_providers" (lower(name));

-- Базовый индекс по активности.
CREATE INDEX IF NOT EXISTS file_storage_providers_active_idx ON "file_storage_providers" (is_active, updated_at DESC);

-- Ссылка на провайдера по умолчанию в workspace.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "default_file_storage_provider_id" varchar
    REFERENCES "file_storage_providers"("id") ON DELETE SET NULL;
