alter table "workspace_llm_usage_ledger"
  add column if not exists "model_id" varchar references "models"("id") on delete set null;

create index if not exists "workspace_llm_usage_ledger_model_id_idx"
  on "workspace_llm_usage_ledger" ("workspace_id", "period_code", "model_id");

alter table "workspace_embedding_usage_ledger"
  add column if not exists "model_id" varchar references "models"("id") on delete set null;

create index if not exists "workspace_embedding_usage_ledger_model_id_idx"
  on "workspace_embedding_usage_ledger" ("workspace_id", "period_code", "model_id");

alter table "workspace_asr_usage_ledger"
  add column if not exists "model_id" varchar references "models"("id") on delete set null;

create index if not exists "workspace_asr_usage_ledger_model_id_idx"
  on "workspace_asr_usage_ledger" ("workspace_id", "period_code", "model_id");
