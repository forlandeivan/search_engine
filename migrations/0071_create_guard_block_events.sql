CREATE TABLE IF NOT EXISTS guard_block_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  resource_type text NOT NULL,
  reason_code text NOT NULL,
  message text NOT NULL,
  upgrade_available boolean NOT NULL DEFAULT false,
  expected_cost jsonb,
  usage_snapshot jsonb,
  meta jsonb,
  request_id text,
  actor_type text,
  actor_id text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS guard_block_events_workspace_idx ON guard_block_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guard_block_events_created_idx ON guard_block_events (created_at DESC);
