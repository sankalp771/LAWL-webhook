# Phase 8 — Back-pressure + Deduplication

## What We Built

### Circuit Breaker (`src/worker/backpressure.ts`)
- If a subscriber has **> 100** deliveries in `pending` or `failed` state, the worker marks the circuit as **open** and skips all their deliveries for that tick.
- Skipped deliveries are immediately released back to `pending` (lock cleared) so they aren't lost.
- Worker logs `[backpressure] Circuit open for subscriber <id>` as a warning.
- Circuit automatically resets (closes) when the backlog drops **below 20** — no manual intervention needed.
- This prevents a slow/dead subscriber from flooding the dispatch queue and starving healthy ones.

### `X-Delivery-Id` Header
- Every outbound HTTP POST now includes `X-Delivery-Id: <delivery_uuid>` in the request headers.
- Subscribers can use this as a deduplication key on their end to safely handle receiving the same webhook twice (at-least-once delivery guarantee).

### Idempotent Success Write
- The database `UPDATE` on success now uses `WHERE id=$1 AND status != 'success'`.
- If a slow network response arrives after the delivery was already retried and succeeded on attempt 2, the late arrival of attempt 1's response is silently discarded — no double-processing.

## How We Verified
- `npm run test` — all 6 test files passed (8 tests, 1 skipped).
- `backpressure.test.ts` verified that `isCircuitOpen` returns `false` for a fresh subscriber with no backlog, and correctly reflects the threshold logic.
