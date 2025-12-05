CREATE TABLE IF NOT EXISTS asr_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid,
  skill_id uuid,
  chat_id uuid,
  user_message_id uuid,
  transcript_message_id uuid,
  transcript_id uuid,
  provider text,
  mode text,
  status text NOT NULL DEFAULT 'pending',
  language text,
  file_name text,
  file_size_bytes bigint,
  duration_ms bigint,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  pipeline_events jsonb
);

CREATE INDEX IF NOT EXISTS asr_executions_created_at_idx ON asr_executions (created_at DESC);
CREATE INDEX IF NOT EXISTS asr_executions_workspace_idx ON asr_executions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS asr_executions_status_idx ON asr_executions (status, created_at DESC);
