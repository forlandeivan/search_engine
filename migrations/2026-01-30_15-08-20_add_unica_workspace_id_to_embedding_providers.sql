-- Add unicaWorkspaceId field for Unica AI embedding provider
-- This field is used to pass the required workSpaceId parameter in Unica AI embedding requests

ALTER TABLE embedding_providers
ADD COLUMN IF NOT EXISTS unica_workspace_id TEXT;

COMMENT ON COLUMN embedding_providers.unica_workspace_id IS 'WorkSpace ID для Unica AI (обязательный параметр для эмбеддингов)';
