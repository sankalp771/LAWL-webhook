import { FastifyInstance } from 'fastify';
import { pool } from '../../db/client';

export async function deliveriesRoutes(app: FastifyInstance) {

  // GET /deliveries — paginated delivery history with last attempt info
  app.get('/deliveries', async (request, reply) => {
    const { subscriber, status, page = '1', per_page = '20' } = request.query as {
      subscriber?: string;
      status?: string;
      page?: string;
      per_page?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const perPage = Math.min(100, Math.max(1, parseInt(per_page)));
    const offset = (pageNum - 1) * perPage;

    const { rows } = await pool.query(
      `SELECT
         d.id, d.event_id, d.subscriber_id, d.status,
         d.attempt_count, d.next_retry_at, d.sequence_id, d.created_at,
         da.status_code, da.latency_ms, da.attempted_at, da.response_body
       FROM deliveries d
       LEFT JOIN LATERAL (
         SELECT status_code, latency_ms, attempted_at, response_body
         FROM delivery_attempts
         WHERE delivery_id = d.id
         ORDER BY attempted_at DESC
         LIMIT 1
       ) da ON true
       WHERE ($1::uuid IS NULL OR d.subscriber_id = $1::uuid)
         AND ($2::text IS NULL OR d.status = $2)
       ORDER BY d.created_at DESC
       LIMIT $3 OFFSET $4`,
      [subscriber ?? null, status ?? null, perPage, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) as total
       FROM deliveries d
       WHERE ($1::uuid IS NULL OR d.subscriber_id = $1::uuid)
         AND ($2::text IS NULL OR d.status = $2)`,
      [subscriber ?? null, status ?? null]
    );

    return reply.status(200).send({
      data: rows,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total: parseInt(countRows[0].total)
      }
    });
  });

  // POST /replay/:delivery_id — re-enqueue a dead delivery as a fresh pending row
  app.post('/replay/:delivery_id', async (request, reply) => {
    const { delivery_id } = request.params as { delivery_id: string };

    const { rows } = await pool.query(
      `SELECT id, event_id, subscriber_id, sequence_id, status FROM deliveries WHERE id = $1`,
      [delivery_id]
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Delivery not found' });
    }

    const original = rows[0];

    if (original.status !== 'dead') {
      return reply.status(409).send({
        error: `Only dead deliveries can be replayed. Current status: ${original.status}`
      });
    }

    const { rows: newRows } = await pool.query(
      `INSERT INTO deliveries (event_id, subscriber_id, sequence_id, status, attempt_count, next_retry_at)
       VALUES ($1, $2, $3, 'pending', 0, now())
       RETURNING id`,
      [original.event_id, original.subscriber_id, original.sequence_id]
    );

    return reply.status(202).send({
      replayed: true,
      original_delivery_id: delivery_id,
      new_delivery_id: newRows[0].id
    });
  });
}
