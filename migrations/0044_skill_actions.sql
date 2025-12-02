-- Skill actions: link between skills and actions

CREATE TABLE IF NOT EXISTS "skill_actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "skill_id" varchar NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "action_id" varchar NOT NULL REFERENCES "actions"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT true,
  "enabled_placements" text[] NOT NULL DEFAULT '{}',
  "label_override" text,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_actions_unique_pair UNIQUE ("skill_id", "action_id")
);

CREATE INDEX IF NOT EXISTS "skill_actions_skill_idx" ON "skill_actions" ("skill_id");
CREATE INDEX IF NOT EXISTS "skill_actions_action_idx" ON "skill_actions" ("action_id");
