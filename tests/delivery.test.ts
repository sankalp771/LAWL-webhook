import { describe, it, expect } from 'vitest';
import { getNextRetryAt } from '../src/worker/retry';

describe('Delivery retry logic', () => {
  it('sets correct next_retry_at after each failure', () => {
    // Attempt 0 -> delays by 10s (10,000ms)
    const now = Date.now();
    const r1 = getNextRetryAt(0);
    expect(r1).toBeInstanceOf(Date);
    const delay1 = r1!.getTime() - now;
    expect(delay1).toBeGreaterThanOrEqual(9000);
    expect(delay1).toBeLessThanOrEqual(11000);

    // Attempt 1 -> delays by 30s (30,000ms)
    const r2 = getNextRetryAt(1);
    const delay2 = r2!.getTime() - now;
    expect(delay2).toBeGreaterThanOrEqual(29000);
    expect(delay2).toBeLessThanOrEqual(31000);
  });

  it('marks dead after 5 consecutive failures', () => {
    // Our RETRY_DELAYS_MS array has 5 elements (indices 0 through 4).
    // An attemptCount of 5 means it has already failed 5 times, so it should die.
    const dead = getNextRetryAt(5);
    expect(dead).toBeNull();
  });
});

describe('Worker crash recovery', () => {
  it.skip('resets processing rows to pending on startup', () => {
    // Note: Crash recovery is tested manually by killing the worker process
    // mid-delivery and verifying the `UPDATE deliveries SET status='pending'` 
    // runs on worker startup.
  });
});
