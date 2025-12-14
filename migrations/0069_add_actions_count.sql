ALTER TABLE workspace_usage_month
ADD COLUMN IF NOT EXISTS actions_count integer NOT NULL DEFAULT 0;
