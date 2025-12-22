ALTER TABLE "skills"
  ADD COLUMN "no_code_callback_token_hash" text,
  ADD COLUMN "no_code_callback_token_last_four" text,
  ADD COLUMN "no_code_callback_token_rotated_at" timestamp;
