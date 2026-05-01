CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  event_types TEXT[] NOT NULL,
  secret TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (url)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  sequence_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  status TEXT DEFAULT 'pending',
  attempt_count INT DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  locked_by TEXT,
  sequence_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id),
  status_code INT,
  response_body TEXT,
  latency_ms INT,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_retry
  ON deliveries(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_subscriber
  ON deliveries(subscriber_id, sequence_id, created_at);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_del
  ON delivery_attempts(delivery_id);
