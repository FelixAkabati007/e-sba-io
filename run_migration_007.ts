import fs from "fs";
import path from "path";
import { pool } from "./server/lib/db";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, "SQL", "007_talent_history.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");

    console.log("Running migration 007...");
    await pool.query(sql);
    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

runMigration();
