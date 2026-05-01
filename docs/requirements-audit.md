# Requirements Compliance Audit

> This document tracks how we discovered and closed gaps between our implementation
> and the original LAWL specification. Written after Phase 9, during the final README pass.

---

## R1 — Subscriber Registration (POST /subscribe)

**Spec:** Registration must be idempotent — posting the same URL and event type twice has exactly zero side effect.

### Gap Found
Our `ON CONFLICT (url) DO UPDATE` was only updating `event_types`, not `secret`. If a subscriber re-registered with a new secret, the old secret was silently kept. This was a correctness bug.

### Fix Applied (Phase 6)
Updated the upsert to also update `secret = EXCLUDED.secret` on conflict, ensuring the latest registration is always the source of truth.

### Final State ✅
- New URL → `201 Created`
- Same URL → `200 OK` with same `id` (verified by `xmax = 0` system column)
- Secret updated on re-registration

---

## R2 — Event Ingest API (POST /event)

**Spec:** Returns 202 immediately. Fan-out is asynchronous. The ingest endpoint must never block on delivery latency.

### Gap Found
None. This was implemented correctly from Phase 3. The route calls `reply.status(202).send()` before the async fan-out block even starts.

### Final State ✅
- Response time consistently under 20ms regardless of subscriber count
- Fan-out runs in a detached async block, never awaited by the request handler

---

## R3 — Delivery Engine with Exponential Backoff

**Spec:** Retry schedule 10s → 30s → 2min → 10min → 1hr. After 5 consecutive failures, mark as dead. Log each attempt with timestamp, HTTP status, response body (truncated to 500 chars), and latency in ms.

### Gap Found
During Phase 4, the crash recovery code in `src/worker/index.ts` referenced `pool` without importing it. This caused `ReferenceError: pool is not defined` on every worker startup — **silently killing the entire delivery pipeline**. All deliveries after Phase 4 were queued but never processed until this was discovered in Phase 6.

### Fix Applied (Phase 6)
Added `pool` to the import statement in `src/worker/index.ts`.

### Final State ✅
- Retry delays: `[10_000, 30_000, 120_000, 600_000, 3_600_000]` ms
- Dead after 5 failures (`getNextRetryAt(5)` returns `null`)
- Every attempt logged: `status_code`, `response_body` (500 char limit), `latency_ms`, `attempted_at`
- Crash recovery resets orphaned `processing` rows on startup

---

## R4 — Ordered Delivery for Sequenced Events

**Spec:** Events with a matching `sequence_id` must be delivered strictly in order. A failure on event N must block event N+1 for that subscriber until N succeeds or goes dead.

### Gap Found
None. Implemented correctly in Phase 5 using a `NOT EXISTS` subquery embedded directly in the dispatcher's `SELECT` query. This makes the blocking check atomic — it cannot race even with multiple concurrent workers.

### Final State ✅
- Ordering enforced at the SQL level, not application code
- Events without `sequence_id` are never blocked (NULL check in subquery)
- Verified by `tests/ordering.test.ts` and Phase 9 harness (0 out-of-order deliveries)

---

## R5 — HMAC Payload Signing

**Spec:** Header must be `X-Webhook-Signature: sha256=<hmac>`. Standalone verification helper required in README.

### Gap Found (Critical — discovered in Phase 10 README audit)
Our `generateSignature()` function returned **bare hex** (`abc123...`) instead of the spec-required format **`sha256=abc123...`**. The `sha256=` prefix was missing from every outbound webhook since Phase 6.

### Fix Applied (Phase 10)
Updated `src/worker/hmac.ts` to prepend `'sha256='`:
```typescript
return 'sha256=' + crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
```
Updated `tests/hmac.test.ts` to assert on the correct format including prefix and length (71 chars, not 64).

### Final State ✅
- Header: `X-Webhook-Signature: sha256=<64-char-hex>`
- Verification helper with constant-time comparison documented in README
- Subscribers can verify using the exact code snippet provided

---

## R6 — Delivery Log & Replay API

**Spec:** `POST /replay/:delivery_id` re-triggers a dead delivery as **a new attempt — not a mutation of the original record**.

### Gap Found (Critical — discovered when testing in Phase 7)
The original replay implementation tried `INSERT INTO deliveries` with the same `event_id` and `subscriber_id`. This hit the `UNIQUE(event_id, subscriber_id)` constraint and returned a `500 Internal Server Error`.

### First Fix (Phase 7 — incorrect)
Changed the INSERT to an UPDATE of the original dead row (`SET status='pending', attempt_count=0`). This worked technically but directly contradicted the spec: "not a mutation of the original record."

### Final Fix (Phase 10 — correct)
Replaced the table-level `UNIQUE(event_id, subscriber_id)` constraint with a **partial unique index**:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_dedup
  ON deliveries(event_id, subscriber_id)
  WHERE status NOT IN ('dead');
```
This allows replay to `INSERT` a brand new delivery row once the original is `dead`, while still preventing duplicate fan-out for live deliveries. The original dead row is untouched — a complete audit trail is preserved.

### Final State ✅
- `GET /deliveries` — paginated with `subscriber`, `status`, `page`, `per_page` filters
- `POST /replay/:id` — inserts a new row, returns both `original_delivery_id` and `new_delivery_id`
- Original dead record preserved as immutable audit entry

---

## Summary

| Requirement | Gaps Found | Fixed In |
|---|---|---|
| R1 — Subscribe idempotency | Secret not updated on re-registration | Phase 6 |
| R2 — 202 non-blocking ingest | None | — |
| R3 — Retry + dead state | `pool` import missing → worker crash | Phase 6 |
| R4 — Ordered delivery | None | — |
| R5 — HMAC signing | Missing `sha256=` prefix | Phase 10 |
| R6 — Replay (new row, not mutation) | UNIQUE constraint blocked INSERT; workaround mutated original | Phase 10 |
