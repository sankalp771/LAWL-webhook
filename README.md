# Webhook Dispatcher

A fault-tolerant webhook fan-out engine built with **Node.js**, **TypeScript**, **Fastify**, and **PostgreSQL**. Ingests events, fans them out to registered subscribers, and guarantees at-least-once delivery with exponential backoff, strict ordered delivery per sequence, HMAC signing, and a full delivery audit log.

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           Fastify API                │
                    │                                      │
  POST /subscribe ──┤  Subscriber Registration (R1)        │
  POST /event     ──┤  Event Ingest → 202 immediately (R2) ├──► PostgreSQL
  GET  /deliveries──┤  Delivery Log + Pagination (R6)      │       │
  POST /replay/:id──┤  Dead Delivery Replay (R6)           │       │
                    └─────────────────────────────────────┘       │
                                                                   │
                    ┌─────────────────────────────────────┐        │
                    │        Background Worker             │◄───────┘
                    │                                      │
                    │  setInterval(1s)                     │
                    │  SELECT ... FOR UPDATE SKIP LOCKED   │──► Subscriber URLs
                    │  Exponential Backoff (R3)            │
                    │  Ordered Delivery Guard (R4)         │
                    │  HMAC Signing (R5)                   │
                    │  Circuit Breaker (Back-pressure)     │
                    └─────────────────────────────────────┘
```

---

## Guarantees

### At-Least-Once Delivery (R3)
Every delivery attempt is persisted before the HTTP call is made. If the worker crashes mid-delivery, the `processing` row is detected on restart (`created_at < now() - 60s`) and reset to `pending`. This ensures no delivery is silently dropped.

Retry schedule on non-2xx or timeout:
```
Attempt 1 → immediate
Attempt 2 → +10 seconds
Attempt 3 → +30 seconds
Attempt 4 → +2 minutes
Attempt 5 → +10 minutes
Attempt 6 → +1 hour → mark DEAD
```

### Strictly Ordered Delivery (R4)
For events with a `sequence_id`, the worker query includes a `NOT EXISTS` subquery before selecting any delivery:

```sql
AND NOT EXISTS (
  SELECT 1 FROM deliveries d2
  WHERE d2.subscriber_id = d.subscriber_id
    AND d2.sequence_id = d.sequence_id
    AND d2.sequence_id IS NOT NULL
    AND d2.status IN ('pending', 'processing', 'failed')
    AND d2.created_at < d.created_at
)
```

If event N is `failed` and waiting on its retry timer, event N+1 is invisible to the worker until N reaches a terminal state (`success` or `dead`). Events without a `sequence_id` are never blocked.

### Deduplication (R8)
Two-layer protection against double delivery:
1. **At the database level**: Success update uses `WHERE id=$1 AND status != 'success'`. A late HTTP response arriving after a retry already succeeded is silently discarded.
2. **At the subscriber level**: Every outbound request includes `X-Delivery-Id: <uuid>`. Subscribers can use this to deduplicate idempotently on their end.

### Crash Recovery
On worker startup, any delivery stuck in `processing` for more than 60 seconds is reset to `pending`:
```sql
UPDATE deliveries
SET status='pending', locked_by=NULL
WHERE status='processing'
  AND locked_by IS NOT NULL
  AND created_at < now() - interval '60 seconds'
```

### Back-pressure (Circuit Breaker)
If a subscriber's pending + failed backlog exceeds **500 deliveries**, the worker skips that subscriber for the current tick and logs a warning. The circuit automatically resets when the backlog drops below 100. No events are dropped — they stay queued and drain as the subscriber recovers.

---

## API Reference

### `POST /subscribe`
Register a subscriber. Idempotent — posting the same URL twice returns `200` with the same ID; a new URL returns `201`.

```json
POST /subscribe
{
  "url": "https://yourapp.com/webhooks",
  "event_types": ["booking.created", "payment.confirmed"],
  "secret": "optional-hmac-secret"
}

// Response 201 (new) or 200 (existing):
{
  "id": "uuid",
  "url": "https://yourapp.com/webhooks",
  "event_types": ["booking.created"],
  "created_at": "2026-05-01T..."
}
```

### `POST /event`
Ingest an event. Always returns `202` immediately — fan-out is async.

```json
POST /event
{
  "type": "booking.created",
  "payload": { "booking_id": "b1", "user_id": "u1" },
  "sequence_id": "tenant-xyz"
}

// Response 202:
{ "status": "accepted" }
```

### `GET /deliveries`
Paginated delivery history. Supports filters:

| Param | Description |
|---|---|
| `subscriber` | Filter by subscriber UUID |
| `status` | `pending`, `failed`, `success`, `dead`, `processing` |
| `page` | Page number (default: 1) |
| `per_page` | Results per page (default: 20, max: 100) |

```json
GET /deliveries?status=dead&page=1

// Response 200:
{
  "data": [{ "id": "...", "status": "dead", "attempt_count": 5, ... }],
  "pagination": { "page": 1, "per_page": 20, "total": 17 }
}
```

### `POST /replay/:delivery_id`
Re-triggers a `dead` delivery as a **new** pending row. The original dead record is preserved in full as an audit trail.

```json
POST /replay/6ef06e1e-...

// Response 202:
{
  "replayed": true,
  "original_delivery_id": "6ef06e1e-...",
  "new_delivery_id": "a3f92c1d-..."
}
```

---

## HMAC Signature Verification (R5)

When a subscriber is registered with a `secret`, every outbound webhook includes:
```
X-Webhook-Signature: sha256=<hmac-hex>
X-Delivery-Id: <delivery-uuid>
```

The signature is computed over the raw JSON body string using HMAC-SHA256.

### Verification Helper

```javascript
const { createHmac, timingSafeEqual } = require('crypto');

/**
 * Verify an incoming webhook signature.
 *
 * @param secret     - The secret you registered with
 * @param rawBody    - The RAW request body string (do NOT parse to JSON first)
 * @param sigHeader  - The value of the X-Webhook-Signature header
 * @returns true if the signature is valid
 */
function verifyWebhookSignature(secret, rawBody, sigHeader) {
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(sigHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Usage with Express:
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const isValid = verifyWebhookSignature(
    process.env.WEBHOOK_SECRET,
    req.body.toString(),           // raw Buffer → string
    req.headers['x-webhook-signature']
  );
  if (!isValid) return res.status(401).send('Invalid signature');
  const event = JSON.parse(req.body);
  // process event...
});
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **PostgreSQL as the queue** | Single system for both data and queue. `FOR UPDATE SKIP LOCKED` enables safe concurrent workers with zero additional infrastructure (no Redis, no RabbitMQ). |
| **`sequence_id` check in SELECT, not application code** | The blocker subquery runs at the database level, making it atomic and race-condition-free — even with multiple workers. |
| **Partial unique index for fan-out dedup** | `UNIQUE(event_id, subscriber_id) WHERE status NOT IN ('dead')` prevents duplicate fan-out while allowing `replay` to insert a fresh row for dead deliveries without violating the constraint. |
| **`xmax = 0` for idempotent 201/200** | PostgreSQL's hidden system column accurately distinguishes an INSERT from an UPDATE-on-conflict without a separate SELECT round-trip. |
| **`X-Delivery-Id` header** | Pushes deduplication responsibility to subscribers for the late-arrival case (slow response returns after retry already succeeded). Defense-in-depth. |
| **Worker crash recovery on startup** | `processing` rows older than 60s are orphaned. Resetting on boot guarantees at-least-once without needing a distributed lock or watchdog. |
| **Circuit breaker at 500 pending deliveries** | Prevents a permanently-down subscriber from monopolizing worker capacity and starving healthy ones. Numbers chosen for 200-event stress test (200 events/subscriber max, trip only at true pathological overload). |

---

## How to Run

### Prerequisites
- Docker Desktop
- Node.js 18+
- A PostgreSQL connection string (Neon DB or local)

### Environment
Create `.env` with:
```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

### Start
```bash
# Start API + Worker
docker-compose up --build

# Run unit tests
npm run test

# Run stress test harness (200 events, 10 subscribers, 3 flaky)
npm run harness
```

### Test it manually
```bash
# Register a subscriber
curl -X POST http://localhost:3000/subscribe \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:4000/hook","event_types":["booking.created"],"secret":"mysecret"}'

# Send an event
curl -X POST http://localhost:3000/event \
  -H "Content-Type: application/json" \
  -d '{"type":"booking.created","payload":{"id":"b1"},"sequence_id":"tenant-1"}'

# Check delivery history
curl "http://localhost:3000/deliveries?status=success"
```

---

## Test Results

```
Test Files  6 passed (6)
     Tests  8 passed | 1 skipped (9)

Stress Harness (200 events × 10 subscribers = 2000 deliveries):
  ✅ PASS: 0 duplicate successful deliveries
  ✅ PASS: 0 out-of-order deliveries
```

---

## Known Limitations

- The worker polls every 1 second via `setInterval`. A production system would benefit from `LISTEN/NOTIFY` for near-instant delivery without polling overhead.
- Replay uses a partial unique index (`WHERE status NOT IN ('dead')`); if the replayed delivery is also killed (goes dead again), a third replay attempt will fail with a unique constraint violation until the second dead row is handled.
- The circuit breaker threshold is global per subscriber — a more sophisticated implementation could apply per-event-type or use exponential circuit recovery timers.
