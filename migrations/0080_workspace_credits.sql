create table if not exists "workspace_credit_accounts" (
  "workspace_id" varchar primary key references "workspaces"("id") on delete cascade,
  "current_balance" bigint not null default 0,
  "next_top_up_at" timestamptz,
  "created_at" timestamptz not null default current_timestamp,
  "updated_at" timestamptz not null default current_timestamp
);

create table if not exists "workspace_credit_ledger" (
  "id" varchar primary key default gen_random_uuid(),
  "workspace_id" varchar not null references "workspaces"("id") on delete cascade,
  "amount_delta" bigint not null,
  "entry_type" text not null,
  "reason" text,
  "source_ref" text not null,
  "plan_id" varchar,
  "plan_code" text,
  "subscription_id" text,
  "period" text,
  "occurred_at" timestamptz not null default current_timestamp,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default current_timestamp
);

create unique index if not exists workspace_credit_ledger_source_uq
  on "workspace_credit_ledger" ("workspace_id", "entry_type", "source_ref");

create index if not exists workspace_credit_ledger_workspace_idx
  on "workspace_credit_ledger" ("workspace_id", "occurred_at");
