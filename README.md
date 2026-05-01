# LAWL Webhook Dispatcher

## Phase 1

This project now includes the Phase 1 foundation:

- PostgreSQL schema bootstrapped from `src/db/schema.sql`
- Fastify API with `GET /health`
- Worker entry point that starts cleanly
- Docker build/runtime files for `api`, `worker`, and `postgres`

## Run

1. Copy `.env.example` to `.env`
2. Run `docker-compose up --build`
3. Open `http://localhost:3000/health`
