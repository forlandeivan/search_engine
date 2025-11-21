-- Adds indexes supporting admin filters (workspace/time/status/error) and cleanup retention.
-- The retention job scans by started_at, so keep that column leading in several indexes.

CREATE INDEX IF NOT EXISTS skill_executions_started_at_idx
  ON skill_executions (started_at DESC);

CREATE INDEX IF NOT EXISTS skill_executions_workspace_started_at_idx
  ON skill_executions (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS skill_executions_status_started_at_idx
  ON skill_executions (status, started_at DESC);

CREATE INDEX IF NOT EXISTS skill_executions_error_started_at_idx
  ON skill_executions (has_step_errors, started_at DESC);

CREATE INDEX IF NOT EXISTS skill_executions_skill_started_at_idx
  ON skill_executions (skill_id, started_at DESC);

CREATE INDEX IF NOT EXISTS skill_execution_steps_execution_idx
  ON skill_execution_steps (execution_id);

