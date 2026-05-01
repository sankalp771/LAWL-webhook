import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

console.log('POOL INIT URL:', process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ??
    'postgresql://lawl:lawl@127.0.0.1:5432/lawl_webhooks',
  max: 10,
});

let schemaPromise: Promise<void> | null = null;

export async function runSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const schemaPath = join(process.cwd(), 'src', 'db', 'schema.sql');
      const schemaSql = await readFile(schemaPath, 'utf8');
      await pool.query(schemaSql);
    })();
  }
  await schemaPromise;
}

export async function pingDatabase() {
  await pool.query('SELECT 1');
}

export async function closePool() {
  schemaPromise = null;
  await pool.end();
}