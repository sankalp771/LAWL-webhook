import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server';
import { closePool } from '../src/db/client';

describe('POST /event', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it('returns 202 without waiting for delivery', async () => {
    const start = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/event',
      payload: {
        type: 'booking.created',
        payload: { booking_id: 'b1' }
      }
    });
    
    expect(res.statusCode).toBe(202);
    expect(Date.now() - start).toBeLessThan(200); // Should be very fast (non-blocking)
  });
});
