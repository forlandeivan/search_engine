-- Add skill mode (rag | llm) to distinguish RAG skills from pure LLM skills
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'rag';

-- Initialize existing records:
-- - System Unica Chat -> llm
-- - Others remain rag (default)
UPDATE skills
SET mode = 'llm'
WHERE is_system = TRUE
  AND system_key = 'UNICA_CHAT';
