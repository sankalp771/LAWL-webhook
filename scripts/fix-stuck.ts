import { pool } from '../src/db/client';

const { rows } = await pool.query(
  `SELECT status, attempt_count, COUNT(*) as count 
   FROM deliveries 
   GROUP BY status, attempt_count
   ORDER BY status, attempt_count`
);
console.table(rows);
await pool.end();
