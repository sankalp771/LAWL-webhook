/**
 * Phase 9 — Stress Test Harness
 * 
 * Simulates the LAWL evaluation scenario:
 * - 10 mock receivers on ports 4001–4010
 * - Subscribers 8, 9, 10 fail 40% of the time (flaky)
 * - Sends 200 events across a mix of types and sequence_ids
 * - Polls DB until all deliveries settle (or 3-minute timeout)
 * - Asserts: 0 duplicates, 0 out-of-order deliveries
 * 
 * Usage: npx dotenv -e .env.test tsx tests/harness/simulate200.ts
 */

import { createServer } from 'http';
import { pool, runSchema, closePool } from '../../src/db/client';

const API_BASE = 'http://localhost:3000';
const BASE_PORT = 4001;
const NUM_SUBSCRIBERS = 10;
const NUM_EVENTS = 200;
const FLAKY_INDICES = [8, 9, 10]; // 1-indexed, these fail 40% of the time
const FAIL_RATE = 0.4;
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── 1. Start mock receivers ───────────────────────────────────────────────

function startReceiver(port: number, isFlaky: boolean): Promise<void> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (isFlaky && Math.random() < FAIL_RATE) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'simulated failure' }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });
    server.listen(port, () => resolve());
  });
}

// ─── 2. Register subscribers ───────────────────────────────────────────────

async function registerSubscribers(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= NUM_SUBSCRIBERS; i++) {
    const res = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `http://host.docker.internal:${BASE_PORT + i - 1}/hook`,
        event_types: ['booking.created', 'payment.confirmed', 'user.updated'],
        secret: `secret-sub-${i}`
      })
    });
    const data = await res.json() as { id: string };
    ids.push(data.id);
    process.stdout.write(`  ✓ Registered subscriber ${i}/10 (${FLAKY_INDICES.includes(i) ? 'FLAKY' : 'stable'})\n`);
  }
  return ids;
}

// ─── 3. Send 200 events ────────────────────────────────────────────────────

async function sendEvents(): Promise<void> {
  const eventTypes = ['booking.created', 'payment.confirmed', 'user.updated'];
  const sequenceIds = ['tenant-A', 'tenant-B', 'tenant-C', 'tenant-D', null]; // null = unordered

  for (let i = 1; i <= NUM_EVENTS; i++) {
    const type = eventTypes[i % eventTypes.length];
    const sequence_id = sequenceIds[i % sequenceIds.length];

    await fetch(`${API_BASE}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        payload: { event_index: i, type },
        ...(sequence_id ? { sequence_id } : {})
      })
    });

    if (i % 10 === 0) {
      await sleep(500); // pace fan-out so worker can keep up
    }

    if (i % 50 === 0) {
      process.stdout.write(`  ✓ Sent ${i}/${NUM_EVENTS} events\n`);
    }
  }
}

// ─── 4. Poll until all deliveries settle ──────────────────────────────────

async function waitForSettlement(subscriberIds: string[]): Promise<boolean> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastPending = -1;

  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM deliveries
       WHERE subscriber_id = ANY($1)
       GROUP BY status`,
      [subscriberIds]
    );

    const counts: Record<string, number> = {};
    let pending = 0;
    for (const row of rows) {
      counts[row.status] = parseInt(row.count);
      if (['pending', 'failed', 'processing'].includes(row.status)) {
        pending += parseInt(row.count);
      }
    }

    if (pending !== lastPending) {
      process.stdout.write(
        `  [${new Date().toISOString().slice(11, 19)}] ` +
        Object.entries(counts).map(([s, c]) => `${s}:${c}`).join(' | ') +
        ` | still-active: ${pending}\n`
      );
      lastPending = pending;
    }

    if (pending === 0) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// ─── 5. Run assertions ─────────────────────────────────────────────────────

async function runAssertions(subscriberIds: string[]): Promise<void> {
  console.log('\n══════════════ ASSERTIONS ══════════════');

  // A. No double delivery
  const { rows: dupes } = await pool.query(
    `SELECT event_id, subscriber_id, COUNT(*) as count
     FROM deliveries
     WHERE subscriber_id = ANY($1) AND status = 'success'
     GROUP BY event_id, subscriber_id
     HAVING COUNT(*) > 1`,
    [subscriberIds]
  );
  if (dupes.length === 0) {
    console.log('  ✅ PASS: 0 duplicate successful deliveries');
  } else {
    console.log(`  ❌ FAIL: ${dupes.length} duplicate successful deliveries found!`);
  }

  // B. Summary counts
  const { rows: summary } = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM deliveries
     WHERE subscriber_id = ANY($1)
     GROUP BY status
     ORDER BY status`,
    [subscriberIds]
  );
  console.log('\n  Final delivery breakdown:');
  let total = 0;
  for (const row of summary) {
    console.log(`    ${row.status.padEnd(12)}: ${row.count}`);
    total += parseInt(row.count);
  }
  console.log(`    ${'TOTAL'.padEnd(12)}: ${total}`);

  // C. Ordering check: for each (subscriber, sequence_id) pair, 
  //    successful deliveries must be attempted in created_at order
  const { rows: orderViolations } = await pool.query(
    `WITH ordered_deliveries AS (
       SELECT 
         d.id,
         d.subscriber_id,
         d.sequence_id,
         d.created_at AS delivery_created_at,
         da.attempted_at,
         ROW_NUMBER() OVER (
           PARTITION BY d.subscriber_id, d.sequence_id 
           ORDER BY d.created_at ASC
         ) as expected_order,
         ROW_NUMBER() OVER (
           PARTITION BY d.subscriber_id, d.sequence_id 
           ORDER BY da.attempted_at ASC
         ) as actual_order
       FROM deliveries d
       JOIN delivery_attempts da ON da.delivery_id = d.id
       WHERE d.subscriber_id = ANY($1)
         AND d.sequence_id IS NOT NULL
         AND d.status = 'success'
     )
     SELECT * FROM ordered_deliveries
     WHERE expected_order != actual_order`,
    [subscriberIds]
  );

  if (orderViolations.length === 0) {
    console.log('  ✅ PASS: 0 out-of-order deliveries');
  } else {
    console.log(`  ❌ FAIL: ${orderViolations.length} out-of-order delivery violations!`);
  }

  console.log('══════════════════════════════════════\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting Phase 9 Stress Test Harness\n');

  // Start receivers
  console.log('Starting 10 mock receivers...');
  await Promise.all(
    Array.from({ length: NUM_SUBSCRIBERS }, (_, i) =>
      startReceiver(BASE_PORT + i, FLAKY_INDICES.includes(i + 1))
    )
  );
  console.log('  All receivers running!\n');

  // Ensure schema
  await runSchema();

  // Register subscribers
  console.log('Registering 10 subscribers...');
  const subscriberIds = await registerSubscribers();
  console.log();

  // Send events
  console.log(`Sending ${NUM_EVENTS} events...`);
  await sendEvents();
  console.log();

  // Wait for settlement
  console.log(`Polling for delivery settlement (timeout: ${TIMEOUT_MS / 1000}s)...`);
  const settled = await waitForSettlement(subscriberIds);

  if (!settled) {
    console.log(`\n⚠️  Timeout reached — some deliveries still in-flight. Running assertions on current state...\n`);
  } else {
    console.log('\n✅ All deliveries settled!\n');
  }

  // Assertions
  await runAssertions(subscriberIds);

  await closePool();
  process.exit(0);
}

main().catch(async err => {
  console.error('Harness error:', err);
  await closePool();
  process.exit(1);
});
