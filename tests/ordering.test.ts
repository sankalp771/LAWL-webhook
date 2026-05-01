import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, runSchema, closePool } from '../src/db/client';

describe('Ordered Delivery Logic', () => {
  beforeAll(async () => {
    await runSchema();
  });

  afterAll(async () => {
    await closePool();
  });

  it('blocks newer deliveries if an older one with same sequence_id is pending/processing/failed', async () => {
    const subscriberUrl = `http://test.com/ordering-${Date.now()}`;
    const sequenceId = `tenant-${Date.now()}`;

    // 1. Create Subscriber
    const { rows: subRows } = await pool.query(
      `INSERT INTO subscribers (url, event_types) VALUES ($1, $2) RETURNING id`,
      [subscriberUrl, ['x.created']]
    );
    const subId = subRows[0].id;

    // 2. Create Event 1 (Older)
    const { rows: e1Rows } = await pool.query(
      `INSERT INTO events (type, payload, sequence_id) VALUES ($1, $2, $3) RETURNING id`,
      ['x.created', { data: 1 }, sequenceId]
    );
    const e1Id = e1Rows[0].id;

    // 3. Create Delivery 1 (Older)
    const { rows: d1Rows } = await pool.query(
      `INSERT INTO deliveries (event_id, subscriber_id, sequence_id, status, created_at) 
       VALUES ($1, $2, $3, 'failed', now() - interval '2 seconds') RETURNING id`,
      [e1Id, subId, sequenceId]
    );
    const d1Id = d1Rows[0].id;

    // 4. Create Event 2 (Newer)
    const { rows: e2Rows } = await pool.query(
      `INSERT INTO events (type, payload, sequence_id) VALUES ($1, $2, $3) RETURNING id`,
      ['x.created', { data: 2 }, sequenceId]
    );
    const e2Id = e2Rows[0].id;

    // 5. Create Delivery 2 (Newer, pending)
    const { rows: d2Rows } = await pool.query(
      `INSERT INTO deliveries (event_id, subscriber_id, sequence_id, status, created_at) 
       VALUES ($1, $2, $3, 'pending', now() - interval '1 second') RETURNING id`,
      [e2Id, subId, sequenceId]
    );
    const d2Id = d2Rows[0].id;

    // 6. Run the exact Dispatcher Query
    const dispatcherQuery = `
      SELECT d.id
      FROM deliveries d
      JOIN events e ON e.id = d.event_id
      WHERE d.status IN ('pending', 'failed') AND d.next_retry_at <= now()
        AND d.subscriber_id = $1
        AND NOT EXISTS (
          SELECT 1 
          FROM deliveries d2
          WHERE d2.subscriber_id = d.subscriber_id
            AND d2.sequence_id = d.sequence_id
            AND d2.sequence_id IS NOT NULL
            AND d2.status IN ('pending', 'processing', 'failed')
            AND d2.created_at < d.created_at
        )
    `;

    const { rows } = await pool.query(dispatcherQuery, [subId]);
    
    // Because d1 is 'failed', d2 MUST be blocked. Only d1 should be returned.
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(d1Id); // d1 is returned for retry, d2 is blocked

    // 7. Unblock by marking d1 as 'success'
    await pool.query(`UPDATE deliveries SET status = 'success' WHERE id = $1`, [d1Id]);

    // 8. Run query again
    const { rows: rowsAfter } = await pool.query(dispatcherQuery, [subId]);

    // Now d2 should be unblocked and returned!
    expect(rowsAfter.length).toBe(1);
    expect(rowsAfter[0].id).toBe(d2Id);
  });
});
