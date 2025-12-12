-- Ledger for embedding token usage per operation/provider/model
CREATE TABLE "workspace_embedding_usage_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_code" varchar(7) NOT NULL,
  "operation_id" varchar NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "tokens_total" integer NOT NULL DEFAULT 0,
  "content_bytes" bigint,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT workspace_embedding_usage_ledger_period_month_check CHECK (period_month >= 1 AND period_month <= 12),
  CONSTRAINT workspace_embedding_usage_ledger_period_code_format_check CHECK (period_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT workspace_embedding_usage_ledger_tokens_total_check CHECK (tokens_total >= 0),
  CONSTRAINT workspace_embedding_usage_ledger_content_bytes_check CHECK (content_bytes IS NULL OR content_bytes >= 0)
);

CREATE UNIQUE INDEX "workspace_embedding_usage_ledger_operation_idx"
  ON "workspace_embedding_usage_ledger" ("workspace_id", "operation_id");

CREATE INDEX "workspace_embedding_usage_ledger_period_idx"
  ON "workspace_embedding_usage_ledger" ("workspace_id", "period_code");

CREATE INDEX "workspace_embedding_usage_ledger_occurred_idx"
  ON "workspace_embedding_usage_ledger" ("workspace_id", "occurred_at");

CREATE INDEX "workspace_embedding_usage_ledger_model_idx"
  ON "workspace_embedding_usage_ledger" ("workspace_id", "period_code", "provider", "model");
