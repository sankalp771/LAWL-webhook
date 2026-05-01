import { pool, closePool, runSchema } from '../db/client';

import { startDispatcher } from './dispatcher';

async function start() {
  try {
    await runSchema();
    
    // Crash recovery
    await pool.query(`
      UPDATE deliveries
      SET status='pending', locked_by=NULL
      WHERE status='processing'
        AND locked_by IS NOT NULL
        AND created_at < now() - interval '60 seconds'
    `);
    
    await startDispatcher();
    console.log('Worker started');
  } catch (error) {
    console.error('Worker failed to start', error);
    await closePool();
    process.exit(1);
  }
}

const shutdown = async () => {
  await closePool();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
