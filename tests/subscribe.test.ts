import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server';
import { closePool, runSchema } from '../src/db/client';

describe('POST /subscribe', () => {
  const app = buildServer();

  beforeAll(async () => {
    await runSchema();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it('returns same id on duplicate registration', async () => {
    const randomUrl = `http://test.com/hook-${Date.now()}-${Math.random()}`;
    const body = { url: randomUrl, event_types: ['x.created'] };
    
    const r1 = await app.inject({
      method: 'POST',
      url: '/subscribe',
      payload: body
    });
    
    expect(r1.statusCode).toBe(201);
    const data1 = JSON.parse(r1.payload);

    const r2 = await app.inject({
      method: 'POST',
      url: '/subscribe',
      payload: body
    });

    expect(r2.statusCode).toBe(200);
    const data2 = JSON.parse(r2.payload);

    expect(data1.id).toBe(data2.id);
  });
});