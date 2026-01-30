-- Add ASR provider type support and skill ASR provider selection
-- Migration: 2026-01-30_18-11-59_asr_provider_selection.sql

-- Add ASR provider type to speech_providers
ALTER TABLE speech_providers 
ADD COLUMN IF NOT EXISTS asr_provider_type TEXT;

-- Add ASR provider selection to skills
ALTER TABLE skills 
ADD COLUMN IF NOT EXISTS asr_provider_id TEXT 
REFERENCES speech_providers(id) ON DELETE SET NULL;

-- Create index for ASR provider lookups
CREATE INDEX IF NOT EXISTS skills_asr_provider_idx ON skills(asr_provider_id);

-- Comments for documentation
COMMENT ON COLUMN speech_providers.asr_provider_type IS 'Type of ASR provider: yandex, unica';
COMMENT ON COLUMN skills.asr_provider_id IS 'Selected ASR provider for standard transcription mode';
