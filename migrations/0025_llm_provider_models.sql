ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS available_models jsonb;

UPDATE llm_providers
SET available_models = '[]'::jsonb
WHERE available_models IS NULL;

ALTER TABLE llm_providers
ALTER COLUMN available_models SET DEFAULT '[]'::jsonb;
