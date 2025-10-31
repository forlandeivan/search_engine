import { defineConfig } from "drizzle-kit";

// Production database configuration
// Uses PG_* environment variables for external PostgreSQL server

const productionUrl = process.env.PG_HOST && process.env.PG_USER && process.env.PG_PASSWORD && process.env.PG_DATABASE
  ? `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT || '5432'}/${process.env.PG_DATABASE}`
  : null;

if (!productionUrl) {
  throw new Error(
    "Production database credentials missing. Required: PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE"
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: productionUrl,
  },
});
