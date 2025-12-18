-- Convert credit amounts to cents (2-decimal fixed precision)
-- After this migration all credit amounts/prices are stored as integer cents.

-- Model price
update "models"
set "credits_per_unit" = "credits_per_unit" * 100;

-- Applied prices snapshots (usage ledgers)
update "workspace_llm_usage_ledger"
set
  "applied_credits_per_unit" = "applied_credits_per_unit" * 100,
  "credits_charged" = "credits_charged" * 100;

update "workspace_embedding_usage_ledger"
set
  "applied_credits_per_unit" = "applied_credits_per_unit" * 100,
  "credits_charged" = "credits_charged" * 100;

update "workspace_asr_usage_ledger"
set
  "applied_credits_per_unit" = "applied_credits_per_unit" * 100,
  "credits_charged" = "credits_charged" * 100;

-- Tariff included credits
update "tariff_plans"
set "included_credits_amount" = "included_credits_amount" * 100;

-- Workspace balance and ledger
update "workspace_credit_accounts"
set "current_balance" = "current_balance" * 100;

update "workspace_credit_ledger"
set "amount_delta" = "amount_delta" * 100;

