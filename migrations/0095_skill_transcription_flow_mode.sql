ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS transcription_flow_mode text NOT NULL DEFAULT 'standard';
