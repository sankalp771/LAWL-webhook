import { pool } from '../db/client';
import crypto from 'crypto';

export async function startDispatcher() {
  setInterval(processDeliveries, 1000);
}

async function processDeliveries() {
  const workerId = crypto.randomUUID();
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. SELECT deliveries WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 10
    const { rows } = await client.query(`
      SELECT d.id, d.subscriber_id, s.url, e.payload 
      FROM deliveries d
      JOIN events e ON e.id = d.event_id
      JOIN subscribers s ON s.id = d.subscriber_id
      WHERE d.status = 'pending' AND d.next_retry_at <= now()
      FOR UPDATE OF d SKIP LOCKED
      LIMIT 10
    `);

    if (rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const deliveryIds = rows.map(r => r.id);

    // 2. Mark each as 'processing' (set locked_by = worker_id)
    await client.query(`
      UPDATE deliveries 
      SET status = 'processing', locked_by = $1 
      WHERE id = ANY($2)
    `, [workerId, deliveryIds]);

    await client.query('COMMIT');

    // 3. Process each delivery concurrently or sequentially
    // (We do it sequentially here for simplicity)
    for (const delivery of rows) {
      const start = Date.now();
      let statusCode: number | null = null;
      let responseBody = '';
      let success = false;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await fetch(delivery.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(delivery.payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        statusCode = response.status;
        responseBody = await response.text();
        success = response.ok;
      } catch (error: any) {
        responseBody = error.message;
      }

      const latencyMs = Date.now() - start;

      // 4. On success: status = 'success', log attempt
      // 5. On failure: status = 'failed', log attempt
      const newStatus = success ? 'success' : 'failed';
      
      await pool.query(`
        UPDATE deliveries 
        SET status = $1, locked_by = NULL
        WHERE id = $2
      `, [newStatus, delivery.id]);

      await pool.query(`
        INSERT INTO delivery_attempts (delivery_id, status_code, response_body, latency_ms)
        VALUES ($1, $2, $3, $4)
      `, [delivery.id, statusCode, responseBody.substring(0, 500), latencyMs]);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Dispatcher loop error', error);
  } finally {
    client.release();
  }
}
