# Phase 3 — Event Ingest + Basic Fan-out

## What We Built
- `POST /event` route implemented to ingest webhook events.
- Immediately returns `202 Accepted` to guarantee non-blocking behavior.
- Fan-out engine safely executed in the background: saving the event to `events` table and duplicating it into the `deliveries` table for all matching `subscribers`.
- Central `dispatcher` worker loop created using `setInterval`.
- Worker uses `FOR UPDATE SKIP LOCKED` to safely query and lock `pending` deliveries without race conditions between multiple workers.
- Worker sends out actual HTTP POST requests to the subscribers using native `fetch`.
- Logs all attempts (status codes, latency, response bodies) into `delivery_attempts` table.

## How We Verified
- Hit `POST /event` in Postman — immediately got `202 Accepted`.
- Watched the mock receiver terminal running on port `4000`.
- Verified the worker correctly parsed the event, hit the mock receiver, and the payload successfully arrived in the terminal console.

## Problems Faced & Fixes

### 1. Docker Networking to Localhost
**Problem:** The background worker running inside the Docker container could not resolve `http://localhost:4000/hook` to hit the mock receiver on the Windows host machine. It resolved `localhost` to itself.
**Fix:** Registered a new subscriber using the special Docker routing URL `http://host.docker.internal:4000/hook`, which correctly routed the webhook out of the container and onto the local Windows machine's mock receiver.
