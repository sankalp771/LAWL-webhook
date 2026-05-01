# Phase 7 — Delivery Log + Replay API

## What We Built

### `GET /deliveries`
- Paginated delivery history with filters: `?status=`, `?subscriber=`, `?page=`, `?per_page=`
- Uses a `LATERAL JOIN` to efficiently pull the most recent `delivery_attempt` row per delivery in a single query (no N+1).
- Returns `{ data: [...], pagination: { page, per_page, total } }`.

### `POST /replay/:delivery_id`
- Accepts only `dead` deliveries — returns `409` for any other status.
- Returns `404` if the delivery ID doesn't exist.
- Resets the dead delivery row in-place: `status='pending'`, `attempt_count=0`, `next_retry_at=now()`, `locked_by=NULL`.
- The original `delivery_attempts` rows are preserved as an audit trail.
- Worker picks up the reset delivery within 1 second and retries from scratch.

## How We Verified
- `GET /deliveries?status=failed` returned all ghost deliveries from old `localhost:4000` attempts.
- `GET /deliveries?status=dead` returned 17 deliveries that correctly exhausted all 5 retry attempts.
- `POST /replay/<dead_id>` returned `202 Accepted` with `"replayed": true, "message": "Delivery reset to pending — worker will retry shortly"`.
- Confirmed the delivery immediately flipped back to `pending` in the DB.

## Problems Faced & Fixes

### 1. `UNIQUE(event_id, subscriber_id)` constraint blocked replay
**Problem:** Initial implementation tried to INSERT a new delivery row for the replayed event, but the constraint on `(event_id, subscriber_id)` rejected it as a duplicate.
**Fix:** Changed the replay logic from `INSERT` to `UPDATE` — resetting the existing dead row's state in-place instead of creating a new one.

### 2. `tsx watch` not picking up new files
**Problem:** After adding `deliveries.ts`, the Docker container didn't auto-reload because `tsx watch` only detects changes to already-loaded files, not new files added to the filesystem.
**Fix:** Ran `docker-compose restart api` to force a restart, which caused `tsx watch` to re-scan and pick up the new route file.
