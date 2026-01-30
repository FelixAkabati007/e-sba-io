
import { pool } from "./server/lib/db";

async function verifyConnection() {
  console.log("Verifying DB connection...");
  try {
    const client = await pool.connect();
    console.log("Successfully connected to the database!");
    
    const res = await client.query('SELECT NOW() as now');
    console.log("Database time:", res.rows[0].now);
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error("Failed to connect to the database:", err);
    process.exit(1);
  }
}

verifyConnection();
