import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { fileURLToPath } from "url";

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

export const pool = mysql.createPool({
  host:
    process.env.DB_HOST ||
    process.env.MYSQL_HOST ||
    process.env.DATABASE_HOST ||
    "localhost",
  user:
    process.env.DB_USER ||
    process.env.MYSQL_USER ||
    process.env.DATABASE_USER ||
    "esba_app_user",
  password:
    process.env.DB_PASS ||
    process.env.DB_PASSWORD ||
    process.env.MYSQL_PASSWORD ||
    process.env.DATABASE_PASSWORD ||
    "",
  database:
    process.env.DB_NAME ||
    process.env.MYSQL_DATABASE ||
    process.env.DATABASE_NAME ||
    "esba_jhs_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
