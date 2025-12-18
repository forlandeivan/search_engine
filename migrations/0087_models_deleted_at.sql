-- Soft-delete timestamp for models (archive without breaking history)
alter table models
  add column if not exists deleted_at timestamp with time zone;

create index if not exists models_deleted_at_idx on models (deleted_at);
