ALTER TABLE knowledge_base_indexing_policy
    ADD COLUMN IF NOT EXISTS policy_hash text;
