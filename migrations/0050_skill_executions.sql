CREATE TABLE IF NOT EXISTS skill_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar NOT NULL,
  user_id varchar,
  skill_id varchar NOT NULL,
  chat_id varchar,
  user_message_id varchar,
  source text NOT NULL,
  status text NOT NULL,
  has_step_errors boolean NOT NULL DEFAULT false,
  started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamp,
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS skill_executions_started_at_idx ON skill_executions (started_at DESC);
CREATE INDEX IF NOT EXISTS skill_executions_workspace_idx ON skill_executions (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS skill_executions_skill_idx ON skill_executions (skill_id, started_at DESC);
CREATE INDEX IF NOT EXISTS skill_executions_chat_idx ON skill_executions (chat_id);
CREATE INDEX IF NOT EXISTS skill_executions_user_idx ON skill_executions (user_id);

CREATE TABLE IF NOT EXISTS skill_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES skill_executions(id) ON DELETE CASCADE,
  "order" integer NOT NULL,
  type text NOT NULL,
  status text NOT NULL,
  started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamp,
  input_payload jsonb,
  output_payload jsonb,
  error_code text,
  error_message text,
  diagnostic_info text
);

CREATE INDEX IF NOT EXISTS skill_execution_steps_execution_idx ON skill_execution_steps (execution_id, "order");
