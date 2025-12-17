-- Add provider linkage to models
alter table models
  add column if not exists provider_id text,
  add column if not exists provider_type text,
  add column if not exists provider_model_key text;

-- Optional uniqueness: provider_id + provider_model_key
create unique index if not exists models_provider_unique_idx
  on models (provider_id, provider_model_key)
  where provider_id is not null and provider_model_key is not null;
