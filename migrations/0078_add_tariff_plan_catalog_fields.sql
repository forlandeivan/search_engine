-- Add short_description and sort_order to tariff_plans
ALTER TABLE tariff_plans
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Ensure existing rows have sort_order set
UPDATE tariff_plans SET sort_order = 0 WHERE sort_order IS NULL;
