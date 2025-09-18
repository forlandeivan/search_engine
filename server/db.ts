import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import { drizzle as neonDrizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

let pool: any;
let db: any;

// Try to connect to custom PostgreSQL server if all credentials are provided
if (process.env.PG_HOST && process.env.PG_USER && process.env.PG_PASSWORD && process.env.PG_DATABASE) {
  try {
    const host = process.env.PG_HOST;
    const port = process.env.PG_PORT || '5432';
    const user = process.env.PG_USER;
    const password = process.env.PG_PASSWORD;
    const database = process.env.PG_DATABASE;
    
    const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${database}`;
    console.log(`[db] Attempting custom PostgreSQL connection: postgresql://${user}:***@${host}:${port}/${database}`);
    
    const customPool = new PgPool({ 
      connectionString: databaseUrl, 
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      max: 10
    });
    
    // Test connection with a simple query
    const testClient = await customPool.connect();
    await testClient.query('SELECT 1');
    testClient.release();
    
    pool = customPool;
    db = pgDrizzle({ client: customPool, schema });
    
    console.log(`[db] ✅ Successfully connected to custom PostgreSQL server`);
    
  } catch (error) {
    console.warn(`[db] ❌ Failed to connect to custom PostgreSQL server: ${error.message}`);
    console.log(`[db] 🔄 Falling back to Replit Neon PostgreSQL`);
    
    // Fallback to Neon
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL must be set for Neon fallback");
    }
    
    pool = new NeonPool({ connectionString: process.env.DATABASE_URL });
    db = neonDrizzle({ client: pool, schema });
    console.log(`[db] Using Replit Neon PostgreSQL as fallback`);
  }
} else {
  // Use Neon if custom credentials are not provided
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set or provide PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE environment variables",
    );
  }
  
  pool = new NeonPool({ connectionString: process.env.DATABASE_URL });
  db = neonDrizzle({ client: pool, schema });
  console.log(`[db] Using Replit Neon PostgreSQL (no custom credentials provided)`);
}

export { pool, db };
