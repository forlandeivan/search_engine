CREATE TABLE IF NOT EXISTS "skills" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text,
  "description" text,
  "system_prompt" text,
  "model_id" varchar,
  "llm_provider_config_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
  "collection_name" text REFERENCES "workspace_vector_collections"("collection_name") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "skill_knowledge_bases" (
  "skill_id" varchar NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
  "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_knowledge_bases_pk PRIMARY KEY ("skill_id", "knowledge_base_id")
);

CREATE INDEX IF NOT EXISTS skills_workspace_idx ON skills(workspace_id);
CREATE INDEX IF NOT EXISTS skills_llm_provider_config_idx ON skills(llm_provider_config_id);
CREATE INDEX IF NOT EXISTS skills_collection_name_idx ON skills(collection_name);

CREATE INDEX IF NOT EXISTS skill_knowledge_bases_workspace_idx ON skill_knowledge_bases(workspace_id);
CREATE INDEX IF NOT EXISTS skill_knowledge_bases_knowledge_base_idx ON skill_knowledge_bases(knowledge_base_id);
