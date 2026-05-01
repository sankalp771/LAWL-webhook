const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000, 3_600_000];

export function getNextRetryAt(attemptCount: number): Date | null {
  if (attemptCount >= RETRY_DELAYS_MS.length) return null;
  return new Date(Date.now() + RETRY_DELAYS_MS[attemptCount]);
}
