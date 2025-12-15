ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS tariff_plan_id varchar NULL;

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_tariff_plan_fk FOREIGN KEY (tariff_plan_id) REFERENCES tariff_plans(id);

CREATE INDEX IF NOT EXISTS workspaces_tariff_plan_id_idx ON workspaces (tariff_plan_id);
