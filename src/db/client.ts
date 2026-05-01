import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Pool } from 'pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://lawl:lawl@postgres:5432/lawl_webhooks';

export const pool = new Pool({
  connectionString,
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
  await pool.end();
}
