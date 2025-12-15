CREATE TABLE IF NOT EXISTS tariff_plans (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tariff_limits (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id varchar NOT NULL REFERENCES tariff_plans(id) ON DELETE CASCADE,
  limit_key text NOT NULL,
  unit text NOT NULL,
  limit_value double precision,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tariff_limits_plan_key UNIQUE (plan_id, limit_key)
);

CREATE INDEX IF NOT EXISTS tariff_limits_plan_idx ON tariff_limits (plan_id);
CREATE INDEX IF NOT EXISTS tariff_limits_plan_key_idx ON tariff_limits (plan_id, limit_key);
