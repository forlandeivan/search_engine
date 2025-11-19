CREATE TABLE IF NOT EXISTS "unica_chat_config" (
  "id" varchar PRIMARY KEY DEFAULT 'singleton',
  "llm_provider_config_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
  "model_id" text,
  "system_prompt" text NOT NULL DEFAULT '',
  "temperature" double precision NOT NULL DEFAULT 0.7,
  "top_p" double precision NOT NULL DEFAULT 1,
  "max_tokens" integer,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "unica_chat_config" ("id", "system_prompt")
VALUES ('singleton', '')
ON CONFLICT ("id") DO NOTHING;
