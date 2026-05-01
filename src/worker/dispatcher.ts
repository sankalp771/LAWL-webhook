import { pool } from '../db/client';
import crypto from 'crypto';
import { getNextRetryAt } from './retry';
import { generateSignature } from './hmac';
import { isCircuitOpen } from './backpressure';

export async function startDispatcher() {
  setInterval(processDeliveries, 1000);
}

async function processDeliveries() {
  const workerId = crypto.randomUUID();
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. SELECT deliveries WHERE status IN ('pending', 'failed') FOR UPDATE SKIP LOCKED LIMIT 10
    // Added Phase 5 Ordered Delivery check (NOT EXISTS subquery)
    const { rows } = await client.query(`
      SELECT d.id, d.subscriber_id, s.url, s.secret, e.payload, d.attempt_count 
      FROM deliveries d
      JOIN events e ON e.id = d.event_id
      JOIN subscribers s ON s.id = d.subscriber_id
      WHERE d.status IN ('pending', 'failed') AND d.next_retry_at <= now()
        AND NOT EXISTS (
          SELECT 1 
          FROM deliveries d2
          WHERE d2.subscriber_id = d.subscriber_id
            AND d2.sequence_id = d.sequence_id
            AND d2.sequence_id IS NOT NULL
            AND d2.status IN ('pending', 'processing', 'failed')
            AND d2.created_at < d.created_at
        )
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
      // Phase 8: Back-pressure circuit breaker
      const circuitOpen = await isCircuitOpen(delivery.subscriber_id);
      if (circuitOpen) {
        // Release lock — don't process this subscriber right now
        await pool.query(
          `UPDATE deliveries SET status='pending', locked_by=NULL WHERE id=$1`,
          [delivery.id]
        );
        console.warn(`[backpressure] Circuit open for subscriber ${delivery.subscriber_id} — skipping`);
        continue;
      }

      const start = Date.now();
      let statusCode: number | null = null;
      let responseBody = '';
      let success = false;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const payloadString = JSON.stringify(delivery.payload);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Delivery-Id': delivery.id,  // Phase 8: dedup anchor for subscribers
        };

        if (delivery.secret) {
          headers['x-webhook-signature'] = generateSignature(payloadString, delivery.secret);
        }

        const response = await fetch(delivery.url, {
          method: 'POST',
          headers,
          body: payloadString,
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
      if (success) {
        // Phase 8: Idempotent write — ignore if a late response already flipped to success
        await pool.query(
          `UPDATE deliveries SET status='success', locked_by=NULL WHERE id=$1 AND status != 'success'`,
          [delivery.id]
        );
      } else {
        const nextRetry = getNextRetryAt(delivery.attempt_count);
        if (!nextRetry) {
          await pool.query(`UPDATE deliveries SET status='dead', locked_by=NULL WHERE id=$1`, [delivery.id]);
        } else {
          await pool.query(`
            UPDATE deliveries 
            SET status = 'failed', attempt_count = attempt_count + 1, next_retry_at = $1, locked_by = NULL
            WHERE id = $2
          `, [nextRetry, delivery.id]);
        }
      }

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
