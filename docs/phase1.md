# Phase 1 — Foundation

## What We Built
- PostgreSQL 15 running in Docker
- Fastify API with `GET /health` → `{ status: 'ok', db: 'connected' }`
- Worker process starts cleanly and logs "Worker started"
- All 4 DB tables created from `src/db/schema.sql` on startup

## How We Verified
- `docker-compose up --build` → all 7/7 services up
- Postman `GET http://localhost:3000/health` → `{ "status": "ok", "db": "connected" }` ✅

## Problems Faced & Fixes

### 1. Read-only filesystem error on first `docker-compose up`
**Error:** `failed commit on ref ... read-only file system`  
**Cause:** Docker Desktop's containerd storage was on a read-only path (Docker Desktop bug).  
**Fix:** Quit Docker Desktop → reopen → storage reset itself on restart.

### 2. `wsl --shutdown` froze Docker
**Cause:** Docker Desktop on Windows runs its engine inside a WSL2 VM. Shutting down WSL killed Docker's backend.  
**Fix:** Fully quit Docker Desktop from system tray and reopen it. Everything came back clean.

### 3. `exec format error` on postgres:15
**Error:** `exec /usr/local/bin/docker-entrypoint.sh: exec format error`  
**Cause:** Docker Desktop's internal exec/binfmt state was corrupted after the forced `wsl --shutdown`.  
**Fix:** Full Docker Desktop quit + restart (not just WSL restart) restored the exec handlers.

### 4. `ENOTFOUND postgres` on api/worker
**Cause:** postgres container crashed before the network formed, so `postgres` hostname never resolved.  
**Fix:** Added `healthcheck` to postgres and `condition: service_healthy` on api/worker in `docker-compose.yml` so they wait for postgres to be truly ready before starting.
