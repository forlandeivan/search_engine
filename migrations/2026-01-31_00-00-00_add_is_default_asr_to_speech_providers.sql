-- Migration: Add is_default_asr column to speech_providers table
-- Allows marking one ASR provider as default for new skills

-- Add is_default_asr column
ALTER TABLE speech_providers 
ADD COLUMN IF NOT EXISTS is_default_asr BOOLEAN NOT NULL DEFAULT false;

-- Create index for faster lookups of default ASR provider
CREATE INDEX IF NOT EXISTS idx_speech_providers_is_default_asr 
ON speech_providers(is_default_asr) 
WHERE is_default_asr = true;

-- Add comment
COMMENT ON COLUMN speech_providers.is_default_asr IS 'Indicates if this ASR provider is the default for new skills';
