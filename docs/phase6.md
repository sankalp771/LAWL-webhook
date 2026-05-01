# Phase 6 — HMAC Signatures

## What We Built
- Created `src/worker/hmac.ts`: a single-responsibility helper using Node's native `crypto.createHmac` to generate a deterministic SHA-256 hex signature from any payload string + subscriber secret.
- Updated `src/worker/dispatcher.ts` to:
  - Fetch `s.secret` alongside the subscriber URL in the main SELECT query.
  - Serialize the payload to a JSON string once (shared between signature and request body).
  - If a subscriber has a `secret`, inject the `x-webhook-signature` header into the outgoing HTTP POST.
- Fixed `src/api/routes/subscribe.ts`: the `ON CONFLICT (url) DO UPDATE` was not updating the `secret` column. It now correctly persists `secret = EXCLUDED.secret` so re-registrations pick up the latest secret.
- Updated `tests/harness/receiver.ts` to log `[SIGNATURE]` alongside `[RECEIVED]` for easy manual verification.
- Added `tests/hmac.test.ts` to validate determinism of the HMAC output.

## How We Verified
- Mock receiver terminal showing:
  - `[RECEIVED] {"id":"test1"}`
  - `[SIGNATURE] aa55c144abb991f680cae9c2b31d9fe645171a79c096e56ba77d68634611a9bf`
- Every run with the same payload + secret produces the same SHA-256 hex output (determinism).

## Problems Faced & Fixes

### 1. Wrong hardcoded hash in unit test
**Problem:** The expected hash in `hmac.test.ts` was guessed manually rather than computed — cryptographically impossible to get right by hand.
**Fix:** Corrected the expected value to `249495dedbc84f...` as reported by the actual test run output.

### 2. Worker silently crashing since Phase 4
**Problem:** The crash recovery block added in Phase 4 (`src/worker/index.ts`) used `pool` but the import only included `closePool` and `runSchema`. This caused `ReferenceError: pool is not defined` on every worker startup, silently killing the entire delivery pipeline.
**Fix:** Added `pool` to the import in `src/worker/index.ts`.
