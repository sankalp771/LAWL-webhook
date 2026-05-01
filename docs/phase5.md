# Phase 5 — Ordered Delivery

## What We Built
- Implemented strict ordering guarantees (Requirement R4) for webhooks based on the `sequence_id` field.
- Updated the main `SELECT` query in `src/worker/dispatcher.ts` to include a `NOT EXISTS` subquery.
- If a delivery fails, it goes into the retry loop (Phase 4). The subquery mathematically blocks the worker from picking up any *newer* deliveries for the same subscriber that share the exact same `sequence_id` until the older delivery reaches a terminal state (`success` or `dead`).
- Unordered events (where `sequence_id` is null) bypass the block check entirely and continue to deliver concurrently at maximum throughput.
- Created an advanced integration test `tests/ordering.test.ts` to directly simulate a delayed delivery in the database and verify the subquery actively blocks the newer event until the older event is marked as `success`.

## How We Verified
- Executed `npm run test` for `tests/ordering.test.ts` which verified the SQL logic safely isolated sequence IDs per subscriber.
