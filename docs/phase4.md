# Phase 4 — Retry Engine + Dead State

## What We Built
- Configured exponential backoff schedule in `src/worker/retry.ts`: 10s, 30s, 2m, 10m, 1h.
- Updated `src/worker/dispatcher.ts` to intelligently query for both `pending` AND `failed` deliveries that have reached their `next_retry_at` timestamp.
- Updated failure logic: instead of dropping failed deliveries, the worker now increments `attempt_count`, calculates the next delay, and saves the new timestamp.
- Implemented the "Dead Letter" state: if an event fails 5 times, `getNextRetryAt` returns `null` and the delivery is permanently marked as `dead`.
- Implemented Crash Recovery in `src/worker/index.ts`. When the worker process boots up, it finds any deliveries stuck in `processing` state for >60 seconds (orphaned by a sudden crash) and reverts them back to `pending`.
- Created `tests/delivery.test.ts` to strictly unit test the date math and array boundary limits for the backoff logic.

## How We Verified
- Executed `npm run test` successfully showing all edge cases of `getNextRetryAt` (including the 5th failure returning `null`) pass cleanly.
- (Manual Verification): By purposefully shutting off the mock receiver and sending an event, you can watch the `deliveries` table increment `attempt_count` and slowly delay the `next_retry_at` time across the exact 5 intervals before officially dying.
