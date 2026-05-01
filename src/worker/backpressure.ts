import { pool } from '../db/client';

const CIRCUIT_OPEN_THRESHOLD = 500;    // pause when backlog > 500
const CIRCUIT_CLOSE_THRESHOLD = 100;   // resume when backlog < 100

export async function isCircuitOpen(subscriberId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as count
     FROM deliveries
     WHERE subscriber_id = $1
       AND status IN ('pending', 'failed')`,
    [subscriberId]
  );
  return parseInt(rows[0].count) > CIRCUIT_OPEN_THRESHOLD;
}

export async function isCircuitReadyToClose(subscriberId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as count
     FROM deliveries
     WHERE subscriber_id = $1
       AND status IN ('pending', 'failed')`,
    [subscriberId]
  );
  return parseInt(rows[0].count) < CIRCUIT_CLOSE_THRESHOLD;
}
