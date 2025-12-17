do $$
begin
  if not exists (select 1 from pg_type where typname = 'model_type') then
    create type "model_type" as enum ('LLM', 'EMBEDDINGS', 'ASR');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'model_consumption_unit') then
    create type "model_consumption_unit" as enum ('TOKENS_1K', 'MINUTES');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'model_cost_level') then
    create type "model_cost_level" as enum ('FREE', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');
  end if;
end$$;

create table if not exists "models" (
  "id" varchar primary key default gen_random_uuid(),
  "model_key" text not null unique,
  "display_name" text not null,
  "description" text,
  "model_type" "model_type" not null,
  "consumption_unit" "model_consumption_unit" not null,
  "cost_level" "model_cost_level" not null default 'MEDIUM',
  "is_active" boolean not null default true,
  "sort_order" integer not null default 0,
  "metadata" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default CURRENT_TIMESTAMP,
  "updated_at" timestamptz not null default CURRENT_TIMESTAMP
);

create index if not exists "models_type_active_idx" on "models" ("model_type", "is_active", "sort_order");

insert into "models" ("model_key", "display_name", "description", "model_type", "consumption_unit", "cost_level", "sort_order")
values
  ('gigachat-lite', 'GigaChat B Lite', 'Базовая LLM модель для генерации текста', 'LLM', 'TOKENS_1K', 'LOW', 10),
  ('gigachat-emb', 'GigaChat Embeddings', 'Эмбеддинги GigaChat для поиска', 'EMBEDDINGS', 'TOKENS_1K', 'LOW', 20),
  ('vosk-ru', 'Vosk RU ASR', 'Русский оффлайн ASR (Vosk)', 'ASR', 'MINUTES', 'FREE', 30)
on conflict ("model_key") do nothing;
