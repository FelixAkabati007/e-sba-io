
import fs from 'fs';
import path from 'path';
import { pool } from './server/db';

async function runSeed() {
  try {
    const sqlPath = path.join(__dirname, 'SQL', '006_seed_rbac_users.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running seed...');
    await pool.query(sql);
    console.log('Seed completed successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
  } finally {
    await pool.end();
  }
}

runSeed();
