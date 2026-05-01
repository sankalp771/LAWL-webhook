# Phase 2 — Subscriber Registration

## What We Built
- `POST /subscribe` route implemented using Fastify.
- Idempotency logic via PostgreSQL `ON CONFLICT (url) DO UPDATE`.
- Used PostgreSQL hidden column `xmax` to correctly differentiate between `201 Created` (insert) and `200 OK` (update).
- `subscribe.test.ts` unit test added using Fastify's native `.inject()`.
- Zero-dependency mock receiver (`tests/harness/receiver.ts`) created using Node's built-in `http` module.
- Switched backend database from local Docker PostgreSQL to Neon DB for better reliability and avoiding local port/auth conflicts.

## How We Verified
- Postman `POST http://localhost:3000/subscribe` → Returns `201 Created` with a new subscriber object.
- Sending the exact same payload in Postman again → Returns `200 OK` while retaining the same `id`.
- `npm run test` executes `subscribe.test.ts` cleanly with no database connection errors.

## Problems Faced & Fixes

### 1. `docker-compose` not syncing code changes
**Problem:** The Docker container was running the old code without the `/subscribe` route because local volumes weren't mapped, causing a `404 Not Found` in Postman.
**Fix:** Added volume mounts (`.:/app`) to `docker-compose.yml` and changed the startup scripts in `package.json` to use `tsx watch` for hot-reloading.

### 2. `vitest` command not found
**Problem:** Running `npm run test` on the host machine failed because dependencies were only installed inside the Docker container.
**Fix:** Ran `npm install` directly on the local machine to populate `node_modules` and make `vitest` available globally.

### 3. Local PostgreSQL Auth / Connection Issues
**Problem:** Tests connecting to the `postgres` hostname threw `ENOTFOUND`, and when mapped to `localhost`, they threw `password authentication failed for user "lawl"`. This happened because Docker Desktop on Windows struggled to properly forward the port and credentials to the host environment.
**Fix:** Completely abandoned the local Docker database and migrated the project to Neon DB. Updated `.env`, `.env.test`, and `src/db/client.ts` to use the remote PostgreSQL connection string.

### 4. PostgreSQL `ON CONFLICT` returning wrong status code
**Problem:** PostgreSQL's `rowCount` returns `1` for both inserts AND updates when using `ON CONFLICT DO UPDATE`. This caused the API to incorrectly return `201 Created` even for duplicate URLs.
**Fix:** Leveraged the hidden PostgreSQL system column `xmax`. If `xmax = 0`, it indicates a fresh insert (`201`), otherwise it's an update (`200`).

### 5. Persistent database breaking idempotency tests
**Problem:** Because Neon DB is persistent, the `http://test.com/hook` URL was saved permanently during the first test run, causing all subsequent test runs to fail (returning `200` instead of the expected `201` for the first request).
**Fix:** Updated `subscribe.test.ts` to generate a random URL per run (e.g., `http://test.com/hook-<timestamp>-<random>`) to ensure strict test isolation.
