-- Add pricing to models and usage ledgers

alter table "models"
  add column if not exists "credits_per_unit" integer not null default 0;

-- Snapshot of applied price per operation (usage ledgers)
alter table "workspace_llm_usage_ledger"
  add column if not exists "applied_credits_per_unit" integer not null default 0,
  add column if not exists "credits_charged" integer not null default 0;

alter table "workspace_embedding_usage_ledger"
  add column if not exists "applied_credits_per_unit" integer not null default 0,
  add column if not exists "credits_charged" integer not null default 0;

alter table "workspace_asr_usage_ledger"
  add column if not exists "applied_credits_per_unit" integer not null default 0,
  add column if not exists "credits_charged" integer not null default 0;

-- Seed example prices (dev convenience)
update "models"
set "credits_per_unit" = case
  when model_key = 'gigachat-lite' then 15
  when model_key = 'gigachat-emb' then 5
  when model_key = 'vosk-ru' then 2
  else "credits_per_unit"
end;
