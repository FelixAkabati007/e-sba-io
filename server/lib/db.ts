import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pg;

(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.resolve(here, "..", "..")];
  const files = [".env", ".env.development", ".env.local"];
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
});

// Test connection
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error acquiring client", err.stack);
  } else {
    console.log("Connected to Neon PostgreSQL database");
    release();
  }
});
