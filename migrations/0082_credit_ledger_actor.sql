alter table "workspace_credit_ledger"
  add column if not exists "actor_user_id" varchar references "users"("id");

create index if not exists "workspace_credit_ledger_actor_idx"
  on "workspace_credit_ledger" ("actor_user_id");
