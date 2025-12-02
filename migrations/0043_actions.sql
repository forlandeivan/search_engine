-- Actions table

CREATE TABLE IF NOT EXISTS "actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "scope" text NOT NULL CHECK ("scope" IN ('system', 'workspace')),
  "workspace_id" varchar REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "description" text,
  "target" text NOT NULL CHECK ("target" IN ('transcript', 'message', 'selection', 'conversation')),
  "placements" text[] NOT NULL DEFAULT '{}',
  "prompt_template" text NOT NULL,
  "input_type" text NOT NULL CHECK ("input_type" IN ('full_transcript', 'selection')),
  "output_mode" text NOT NULL CHECK ("output_mode" IN ('replace_text', 'new_version', 'new_message', 'document')),
  "llm_config_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp,
  CONSTRAINT actions_scope_workspace_chk CHECK (
    ("scope" = 'system' AND "workspace_id" IS NULL)
    OR ("scope" = 'workspace' AND "workspace_id" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "actions_workspace_idx" ON "actions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "actions_scope_idx" ON "actions" ("scope");
