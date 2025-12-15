-- Ensure tariff_plan_id is always set (defaults to FREE) and enforce NOT NULL
DO $$
DECLARE
  free_id uuid;
BEGIN
  SELECT id INTO free_id FROM tariff_plans WHERE code = 'FREE' LIMIT 1;
  IF free_id IS NULL THEN
    RAISE EXCEPTION 'FREE tariff plan not found. Run tariff seed before this migration.';
  END IF;

  -- Fill missing references with FREE
  UPDATE workspaces
  SET tariff_plan_id = free_id
  WHERE tariff_plan_id IS NULL;

  -- Default helper to keep future inserts aligned with FREE
  CREATE OR REPLACE FUNCTION get_free_tariff_plan_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $fn$
  SELECT id FROM tariff_plans WHERE code = 'FREE' LIMIT 1
$fn$;

  -- Set default and enforce NOT NULL
  ALTER TABLE workspaces
    ALTER COLUMN tariff_plan_id SET DEFAULT get_free_tariff_plan_id(),
    ALTER COLUMN tariff_plan_id SET NOT NULL;
END $$;
