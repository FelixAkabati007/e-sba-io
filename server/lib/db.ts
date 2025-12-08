import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "esba_app_user",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "esba_jhs_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
