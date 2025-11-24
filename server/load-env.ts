import path from "path";
import { config } from "dotenv";

const defaultEnvPath = path.resolve(import.meta.dirname, "..", ".env");
const envPath = process.env.DOTENV_PATH?.trim() || defaultEnvPath;

config({ path: envPath });
