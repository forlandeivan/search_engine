-- Backfill tariff_plan_id with FREE plan for existing workspaces
DO $$
DECLARE
  free_plan_id varchar;
BEGIN
  SELECT id INTO free_plan_id FROM tariff_plans WHERE code = 'FREE' LIMIT 1;
  IF free_plan_id IS NULL THEN
    RAISE EXCEPTION 'FREE tariff plan not found';
  END IF;

  UPDATE workspaces
  SET tariff_plan_id = free_plan_id
  WHERE tariff_plan_id IS NULL;
END $$;
