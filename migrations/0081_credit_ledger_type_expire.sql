alter table "workspace_credit_ledger"
  add column if not exists "credit_type" text not null default 'subscription',
  add column if not exists "expires_at" timestamptz;
