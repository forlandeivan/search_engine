import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveEnvPath(): string | null {
  const candidates = [
    process.env.DOTENV_PATH?.trim(),
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const envPath = resolveEnvPath();

if (envPath) {
  config({ path: envPath });
} else {
  console.warn("[env] .env file not found; environment variables must be provided explicitly.");
}
