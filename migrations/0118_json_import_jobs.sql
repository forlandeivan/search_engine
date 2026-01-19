-- Таблица для хранения задач импорта JSON/JSONL
CREATE TABLE IF NOT EXISTS json_import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    base_id varchar NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'processing', 'completed', 'completed_with_errors', 'failed')),
    
    -- Конфигурация маппинга
    mapping_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    hierarchy_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    
    -- Прогресс
    total_records integer NOT NULL DEFAULT 0,
    processed_records integer NOT NULL DEFAULT 0,
    created_documents integer NOT NULL DEFAULT 0,
    skipped_records integer NOT NULL DEFAULT 0,
    error_records integer NOT NULL DEFAULT 0,
    
    -- S3 хранение
    source_file_key text NOT NULL,
    source_file_name text NOT NULL,
    source_file_size bigint NOT NULL DEFAULT 0,
    source_file_format text NOT NULL CHECK (source_file_format IN ('json', 'jsonl')),
    
    -- Метаданные
    attempts integer NOT NULL DEFAULT 0,
    next_retry_at timestamp,
    last_error text,
    error_log jsonb NOT NULL DEFAULT '[]'::jsonb,
    
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp,
    finished_at timestamp,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS json_import_jobs_workspace_base_idx
    ON json_import_jobs(workspace_id, base_id);

CREATE INDEX IF NOT EXISTS json_import_jobs_status_idx
    ON json_import_jobs(status, created_at)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS json_import_jobs_next_retry_idx
    ON json_import_jobs(next_retry_at)
    WHERE status = 'pending' AND next_retry_at IS NOT NULL;
