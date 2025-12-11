-- Ensure knowledge_nodes.type matches enum knowledge_node_type
-- 1) Create enum if missing (adjust values to match shared/schema.ts)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'knowledge_node_type') THEN
    CREATE TYPE knowledge_node_type AS ENUM ('folder', 'document');
  END IF;
END $$;

-- 2) Cast column with explicit USING to avoid errors
ALTER TABLE "knowledge_nodes"
  ALTER COLUMN "type" TYPE knowledge_node_type USING type::knowledge_node_type;
