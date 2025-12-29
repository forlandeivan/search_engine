ALTER TABLE skills
ADD COLUMN IF NOT EXISTS no_code_file_storage_provider_id VARCHAR REFERENCES file_storage_providers(id) ON DELETE SET NULL;
