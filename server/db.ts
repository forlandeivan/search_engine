import "./load-env";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool as PgPool, PoolClient } from "pg";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-serverless";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";
import { createLogger } from "./lib/logger";

// ВАЖНО: все timestamps храним в UTC. Таймзона выставляется на уровне соединения.
process.env.TZ = process.env.TZ || "UTC";
process.env.PGTZ = process.env.PGTZ || "UTC";

neonConfig.webSocketConstructor = ws;

type Database = NodePgDatabase<typeof schema> | NeonDatabase<typeof schema> | UnavailableDbProxy;
type DatabasePool = PgPool | NeonPool | null;

interface UnavailableDbProxy {
  [key: string]: never;
}

let pool: DatabasePool = null;
let db: Database | null = null;
let lastDatabaseError: string | null = null;

const dbLogger = createLogger('db');

// SQL logging is controlled by LOG_SQL environment variable
// In production, SQL queries are not logged by default to reduce overhead
const shouldLogSql = process.env.LOG_SQL === 'true';

const sqlLoggerConfig = shouldLogSql ? {
  logQuery(query: string, params: unknown[]) {
    dbLogger.debug({ sql: query, params }, 'SQL Query');
  }
} : false;

function formatConnectionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

function createUnavailableDbProxy(message: string): UnavailableDbProxy {
  const handler: ProxyHandler<UnavailableDbProxy> = {
    get() {
      return new Proxy({} as UnavailableDbProxy, handler);
    },
    apply() {
      throw new Error(message);
    },
  };

  return new Proxy({} as UnavailableDbProxy, handler);
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
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 30_000,
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
      max: Number(process.env.PG_POOL_MAX) || 50,
      min: Number(process.env.PG_POOL_MIN) || 5,
      statement_timeout: 30_000,
      allowExitOnIdle: true,
    });

    customPool.on("connect", (client: PoolClient) => {
      client.query("SET TIME ZONE 'UTC'").catch((error: unknown) => {
        console.warn("[db] Failed to set timezone UTC for custom pool client:", error);
      });
    });

    customPool.on("error", (err) => {
      dbLogger.error({ err }, "Pool error");
    });

    pool = customPool;
    db = pgDrizzle({ 
      client: customPool, 
      schema,
      logger: sqlLoggerConfig,
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
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 30_000,
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
      max: Number(process.env.PG_POOL_MAX) || 50,
      min: Number(process.env.PG_POOL_MIN) || 5,
      statement_timeout: 30_000,
      allowExitOnIdle: true,
    });

    pgPool.on("connect", (client) => {
      client.query("SET TIME ZONE 'UTC'").catch((error) => {
        console.warn("[db] Failed to set timezone UTC for pgPool client:", error);
      });
      dbLogger.debug({ total: pgPool.totalCount }, "Client connected");
    });

    pgPool.on("error", (err) => {
      dbLogger.error({ err }, "Pool error");
    });

    pool = pgPool;
    db = pgDrizzle({ 
      client: pgPool, 
      schema,
      logger: sqlLoggerConfig,
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
  if (pool || db) {
    console.log(`[db] Database already connected - skipping DATABASE_URL connection`);
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
      pool.on("connect", (client) => {
        if (client && typeof client === 'object' && 'query' in client) {
          (client as { query: (query: string) => Promise<unknown> }).query("SET TIME ZONE 'UTC'").catch((error: unknown) => {
            console.warn("[db] Failed to set timezone UTC for Neon client:", error);
          });
        }
      });
      db = neonDrizzle({ 
        client: pool, 
        schema,
        logger: sqlLoggerConfig,
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
  ) as Database;
  pool = null;
}

const isDatabaseConfigured = Boolean(pool);

// Ensure db is always initialized before export
if (!db) {
  db = createUnavailableDbProxy("Database not initialized") as Database;
}

// Export db - it's always initialized at this point (either real connection or proxy)
// Using non-null assertion since db is guaranteed to be initialized above
const dbExport: Database = db!;
export { pool };
export { dbExport as db };
export { isDatabaseConfigured };
