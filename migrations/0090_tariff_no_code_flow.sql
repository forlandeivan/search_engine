-- Add no-code flow access flag to tariff plans
ALTER TABLE "tariff_plans"
  ADD COLUMN IF NOT EXISTS "no_code_flow_enabled" boolean;

UPDATE "tariff_plans"
SET "no_code_flow_enabled" = false
WHERE "no_code_flow_enabled" IS NULL;

ALTER TABLE "tariff_plans"
  ALTER COLUMN "no_code_flow_enabled" SET DEFAULT false;

ALTER TABLE "tariff_plans"
  ALTER COLUMN "no_code_flow_enabled" SET NOT NULL;
