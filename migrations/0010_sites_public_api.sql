CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "sites" ADD COLUMN "public_id" varchar;
ALTER TABLE "sites" ADD COLUMN "public_api_key" text DEFAULT encode(gen_random_bytes(32), 'hex');
ALTER TABLE "sites" ADD COLUMN "public_api_key_generated_at" timestamp DEFAULT CURRENT_TIMESTAMP;

UPDATE "sites"
SET
  "public_id" = COALESCE("public_id", gen_random_uuid()),
  "public_api_key" = COALESCE("public_api_key", encode(gen_random_bytes(32), 'hex')),
  "public_api_key_generated_at" = COALESCE("public_api_key_generated_at", CURRENT_TIMESTAMP);

ALTER TABLE "sites" ALTER COLUMN "public_id" SET NOT NULL;
ALTER TABLE "sites" ALTER COLUMN "public_api_key" SET NOT NULL;
ALTER TABLE "sites" ALTER COLUMN "public_api_key_generated_at" SET NOT NULL;

ALTER TABLE "sites" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();
ALTER TABLE "sites" ALTER COLUMN "public_api_key" SET DEFAULT encode(gen_random_bytes(32), 'hex');

ALTER TABLE "sites" ADD CONSTRAINT "sites_public_id_unique" UNIQUE("public_id");
