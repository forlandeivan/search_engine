CREATE TABLE IF NOT EXISTS "workspace_asr_usage_ledger" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_code" varchar(7) NOT NULL,
  "asr_job_id" varchar NOT NULL,
  "provider" text,
  "model" text,
  "duration_seconds" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_asr_usage_ledger_job_idx
  ON "workspace_asr_usage_ledger" ("workspace_id", "asr_job_id");

CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_period_idx
  ON "workspace_asr_usage_ledger" ("workspace_id", "period_code");

CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_occurred_idx
  ON "workspace_asr_usage_ledger" ("workspace_id", "occurred_at");

CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_provider_model_idx
  ON "workspace_asr_usage_ledger" ("workspace_id", "period_code", "provider", "model");
