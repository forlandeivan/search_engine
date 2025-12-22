ALTER TABLE "skills"
  ADD COLUMN "no_code_endpoint_url" text,
  ADD COLUMN "no_code_auth_type" text NOT NULL DEFAULT 'none',
  ADD COLUMN "no_code_bearer_token" text;

ALTER TABLE "skills"
  ADD CONSTRAINT "skills_no_code_auth_type_check"
  CHECK ("no_code_auth_type" IN ('none', 'bearer'));
