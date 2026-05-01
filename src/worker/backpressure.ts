import { pool } from '../db/client';

const CIRCUIT_OPEN_THRESHOLD = 100;   // pause when backlog > 100
const CIRCUIT_CLOSE_THRESHOLD = 20;   // resume when backlog < 20

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
