import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool } from "pg";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

let pool: any = null;
let db: any = null;
let lastDatabaseError: string | null = null;

function formatConnectionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

function createUnavailableDbProxy(message: string) {
  const handler: ProxyHandler<any> = {
    get() {
      return new Proxy(() => {}, handler);
    },
    apply() {
      throw new Error(message);
    },
  };

  return new Proxy(() => {}, handler);
}

function hasCustomPostgresConfig(): boolean {
  return Boolean(
    process.env.PG_HOST &&
    process.env.PG_USER &&
    process.env.PG_PASSWORD &&
    process.env.PG_DATABASE
  );
}

function tryConnectCustomPostgres(): void {
  if (!hasCustomPostgresConfig()) {
    console.log(`[db] Custom PostgreSQL config not found (PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE required)`);
    return;
  }

  try {
    const host = process.env.PG_HOST;
    const port = process.env.PG_PORT || "5432";
    const user = process.env.PG_USER;
    const password = process.env.PG_PASSWORD;
    const database = process.env.PG_DATABASE;

    const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;
    console.log(`[db] Attempting custom PostgreSQL connection: postgresql://${user}:***@${host}:${port}/${database}`);

    const customPool = new PgPool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 45_000,
      idleTimeoutMillis: 60_000,
      max: 20,
      allowExitOnIdle: true,
    });

    pool = customPool;
    db = pgDrizzle({ 
      client: customPool, 
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          console.log('[SQL]', query);
          if (params && params.length > 0) {
            console.log('[SQL PARAMS]', params);
          }
        }
      }
    });

    console.log(`[db] ✅ Successfully configured custom PostgreSQL connection`);
  } catch (error) {
    const message = formatConnectionError(error);
    console.warn(`[db] ❌ Failed to configure custom PostgreSQL connection: ${message}`);
    lastDatabaseError = message;
    pool = null;
    db = null;
  }
}

function resolveDatabaseUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.PROD_DATABASE_URL,
    process.env.PRODUCTION_DATABASE_URL,
    process.env.NEON_DATABASE_URL,
  ]
    .map(candidate => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate && candidate.length > 0));

  if (candidates.length === 0) {
    return null;
  }

  return candidates[0] ?? null;
}

function isLikelyNeonConnection(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase();

    return hostname.endsWith(".neon.tech") || hostname === "neon.tech";
  } catch {
    return false;
  }
}

function connectUsingPgPool(databaseUrl: string): void {
  try {
    const pgPool = new PgPool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 45_000,
      idleTimeoutMillis: 60_000,
      max: 20,
      allowExitOnIdle: true,
    });

    pool = pgPool;
    db = pgDrizzle({ 
      client: pgPool, 
      schema,
      logger: {
        logQuery(query: string, params: unknown[]) {
          console.log('[SQL]', query);
          if (params && params.length > 0) {
            console.log('[SQL PARAMS]', params);
          }
        }
      }
    });

    console.log(`[db] ✅ Using PostgreSQL connection string via node-postgres`);
  } catch (error) {
    const message = formatConnectionError(error);
    console.warn(`[db] ❌ Failed to configure PostgreSQL connection via node-postgres: ${message}`);
    lastDatabaseError = message;
    pool = null;
    db = null;
  }
}

function tryConnectDatabaseUrl(): void {
  if (hasCustomPostgresConfig()) {
    console.log(`[db] Skipping DATABASE_URL connection - custom PostgreSQL config is present`);
    return;
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    console.log(`[db] No DATABASE_URL found for connection`);
    return;
  }

  if (isLikelyNeonConnection(databaseUrl)) {
    try {
      pool = new NeonPool({ connectionString: databaseUrl });
      db = neonDrizzle({ 
        client: pool, 
        schema,
        logger: {
          logQuery(query: string, params: unknown[]) {
            console.log('[SQL]', query);
            if (params && params.length > 0) {
              console.log('[SQL PARAMS]', params);
            }
          }
        }
      });
      console.log(`[db] ✅ Using Neon/PostgreSQL connection string`);
      return;
    } catch (error) {
      const message = formatConnectionError(error);
      console.warn(`[db] ❌ Failed to configure Neon/PostgreSQL connection: ${message}`);
      lastDatabaseError = message;
      pool = null;
      db = null;
    }
  }

  if (!pool || !db) {
    connectUsingPgPool(databaseUrl);
  }
}

console.log(`[db] ===== DATABASE CONNECTION DIAGNOSTICS =====`);
console.log(`[db] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
console.log(`[db] PG_HOST: ${process.env.PG_HOST ? `set (${process.env.PG_HOST})` : 'NOT SET'}`);
console.log(`[db] PG_USER: ${process.env.PG_USER ? 'set' : 'NOT SET'}`);
console.log(`[db] PG_PASSWORD: ${process.env.PG_PASSWORD ? 'set' : 'NOT SET'}`);
console.log(`[db] PG_DATABASE: ${process.env.PG_DATABASE ? `set (${process.env.PG_DATABASE})` : 'NOT SET'}`);
console.log(`[db] DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);
console.log(`[db] ============================================`);

tryConnectCustomPostgres();

if (!pool || !db) {
  tryConnectDatabaseUrl();
}

if (!pool || !db) {
  const message =
    lastDatabaseError ??
    "DATABASE_URL must be set or provide PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE environment variables";

  console.error(`[db] ⚠️ База данных недоступна: ${message}`);
  db = createUnavailableDbProxy(
    `База данных недоступна: ${message}. Проверьте переменные окружения или подключение к PostgreSQL`,
  );
  pool = null;
}

const isDatabaseConfigured = Boolean(pool);

export { pool, db, isDatabaseConfigured };
