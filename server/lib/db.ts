import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import pg from "pg";
// __dirname works under CommonJS; for ESM builds, process.cwd() fallback is included below.

const { Pool } = pg;

(() => {
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  const roots = [process.cwd(), path.resolve(here, "..", "..")];
  const files = [".env", ".env.development", ".env.local", ".env.production"];
  for (const r of roots) {
    for (const f of files) {
      const p = path.join(r, f);
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
      }
    }
  }
})();

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is not set. Database connection may fail.");
}

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, // Required for Neon
  },
  max: 20, // Connection pool limit
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
});

/**
 * Executes a database query with automatic retry logic for transient errors.
 * Suitable for idempotent read operations or safe writes.
 */
export async function queryWithRetry<
  T extends pg.QueryResultRow = pg.QueryResultRow,
>(
  text: string,
  params?: unknown[],
  retries = 3,
  delayMs = 500,
): Promise<pg.QueryResult<T>> {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query<T>(text, params);
    } catch (err: unknown) {
      const dbErr = err as { code?: string; message?: string };
      const code = dbErr.code;
      const message = dbErr.message || "";
      const isTransient =
        code === "57P01" || // admin_shutdown
        code === "57P02" || // crash_shutdown
        code === "57P03" || // cannot_connect_now
        code === "08006" || // connection_failure
        code === "08003" || // connection_does_not_exist
        code === "08001" || // sqlclient_unable_to_establish_sqlconnection
        message.includes("timeout") ||
        message.includes("ECONNRESET");

      if (!isTransient || i === retries - 1) {
        throw err;
      }

      const backoff = delayMs * Math.pow(2, i);
      console.warn(
        `DB Query failed (attempt ${i + 1}/${retries}). Retrying in ${backoff}ms...`,
        message,
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw new Error("Unreachable");
}

// Test connection
pool.connect((err, _client, release) => {
  if (err) {
    console.error("Error acquiring client", err.stack);
  } else {
    console.log("Connected to Neon PostgreSQL database");
    release();
  }
});
