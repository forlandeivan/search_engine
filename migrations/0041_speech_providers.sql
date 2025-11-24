CREATE TABLE IF NOT EXISTS "speech_providers" (
  "id" text PRIMARY KEY,
  "display_name" text NOT NULL,
  "provider_type" text NOT NULL DEFAULT 'stt',
  "direction" text NOT NULL DEFAULT 'audio_to_text',
  "is_enabled" boolean NOT NULL DEFAULT FALSE,
  "status" text NOT NULL DEFAULT 'Disabled',
  "last_status_changed_at" timestamp,
  "last_validation_at" timestamp,
  "last_error_code" text,
  "last_error_message" text,
  "config_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_built_in" boolean NOT NULL DEFAULT FALSE,
  "updated_by_admin_id" varchar REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "speech_provider_secrets" (
  "provider_id" text NOT NULL REFERENCES "speech_providers"("id") ON DELETE CASCADE,
  "secret_key" text NOT NULL,
  "secret_value" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT speech_provider_secrets_pk PRIMARY KEY ("provider_id", "secret_key")
);

INSERT INTO "speech_providers" (
  "id",
  "display_name",
  "provider_type",
  "direction",
  "is_enabled",
  "status",
  "config_json",
  "is_built_in",
  "created_at",
  "updated_at"
)
SELECT
  'yandex_speechkit',
  'Yandex SpeechKit',
  'stt',
  'audio_to_text',
  FALSE,
  'Disabled',
  '{}'::jsonb,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "speech_providers" WHERE "id" = 'yandex_speechkit'
);
