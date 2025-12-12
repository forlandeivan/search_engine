-- Ledger for LLM token usage per execution / provider / model
CREATE TABLE "workspace_llm_usage_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_code" varchar(7) NOT NULL,
  "execution_id" varchar NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "tokens_total" integer NOT NULL DEFAULT 0,
  "tokens_prompt" integer,
  "tokens_completion" integer,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_llm_usage_ledger_period_month_check CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT workspace_llm_usage_ledger_period_code_format_check CHECK (period_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT workspace_llm_usage_ledger_tokens_total_check CHECK (tokens_total >= 0),
  CONSTRAINT workspace_llm_usage_ledger_tokens_prompt_check CHECK (tokens_prompt IS NULL OR tokens_prompt >= 0),
  CONSTRAINT workspace_llm_usage_ledger_tokens_completion_check CHECK (tokens_completion IS NULL OR tokens_completion >= 0)
);

CREATE UNIQUE INDEX "workspace_llm_usage_ledger_execution_idx"
  ON "workspace_llm_usage_ledger" ("workspace_id", "execution_id");

CREATE INDEX "workspace_llm_usage_ledger_period_idx"
  ON "workspace_llm_usage_ledger" ("workspace_id", "period_code");

CREATE INDEX "workspace_llm_usage_ledger_occurred_idx"
  ON "workspace_llm_usage_ledger" ("workspace_id", "occurred_at");

CREATE INDEX "workspace_llm_usage_ledger_model_idx"
  ON "workspace_llm_usage_ledger" ("workspace_id", "period_code", "provider", "model");
