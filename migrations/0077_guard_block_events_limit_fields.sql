ALTER TABLE guard_block_events
  ADD COLUMN IF NOT EXISTS limit_key text,
  ADD COLUMN IF NOT EXISTS limit_current double precision,
  ADD COLUMN IF NOT EXISTS limit_value double precision,
  ADD COLUMN IF NOT EXISTS limit_unit text;
