-- Workspace usage aggregate per workspace and calendar month
CREATE TABLE "workspace_usage_month" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_code" varchar(7) NOT NULL,
  "llm_tokens_total" bigint NOT NULL DEFAULT 0,
  "embeddings_tokens_total" bigint NOT NULL DEFAULT 0,
  "asr_minutes_total" double precision NOT NULL DEFAULT 0,
  "storage_bytes_total" bigint NOT NULL DEFAULT 0,
  "skills_count" integer NOT NULL DEFAULT 0,
  "knowledge_bases_count" integer NOT NULL DEFAULT 0,
  "members_count" integer NOT NULL DEFAULT 0,
  "extra_metrics" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_closed" boolean NOT NULL DEFAULT false,
  "closed_at" timestamp with time zone,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_usage_month_period_month_check CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT workspace_usage_month_period_code_format_check CHECK (period_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT workspace_usage_month_llm_tokens_total_check CHECK (llm_tokens_total >= 0),
  CONSTRAINT workspace_usage_month_embeddings_tokens_total_check CHECK (embeddings_tokens_total >= 0),
  CONSTRAINT workspace_usage_month_asr_minutes_total_check CHECK (asr_minutes_total >= 0),
  CONSTRAINT workspace_usage_month_storage_bytes_total_check CHECK (storage_bytes_total >= 0),
  CONSTRAINT workspace_usage_month_skills_count_check CHECK (skills_count >= 0),
  CONSTRAINT workspace_usage_month_knowledge_bases_count_check CHECK (knowledge_bases_count >= 0),
  CONSTRAINT workspace_usage_month_members_count_check CHECK (members_count >= 0)
);

CREATE UNIQUE INDEX "workspace_usage_month_workspace_period_idx"
  ON "workspace_usage_month" ("workspace_id", "period_code");
