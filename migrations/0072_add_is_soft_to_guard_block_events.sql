ALTER TABLE guard_block_events
  ADD COLUMN IF NOT EXISTS is_soft boolean NOT NULL DEFAULT false;
