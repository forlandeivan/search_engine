alter table "tariff_plans"
  add column if not exists "included_credits_amount" integer not null default 0,
  add column if not exists "included_credits_period" text not null default 'monthly';

update "tariff_plans"
set "included_credits_period" = 'monthly'
where "included_credits_period" is null or "included_credits_period" = '';
