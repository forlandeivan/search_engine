ALTER TABLE "embedding_providers"
  ADD COLUMN "allow_self_signed_certificate" boolean NOT NULL DEFAULT false;
