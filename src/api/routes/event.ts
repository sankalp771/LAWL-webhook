import { FastifyInstance } from 'fastify';
import { pool } from '../../db/client';

export async function eventRoutes(app: FastifyInstance) {
  app.post('/event', async (request, reply) => {
    const { type, payload, sequence_id } = request.body as {
      type: string;
      payload: Record<string, any>;
      sequence_id?: string;
    };

    if (!type || typeof type !== 'string') {
      return reply.status(400).send({ error: 'type must be a string' });
    }

    if (!payload || typeof payload !== 'object') {
      return reply.status(400).send({ error: 'payload must be a JSON object' });
    }

    // 1. Immediately return 202 Accepted
    reply.status(202).send({ status: 'accepted' });

    // 2. Process fan-out asynchronously in the background
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Save event
        const { rows: eventRows } = await client.query(
          `INSERT INTO events (type, payload, sequence_id)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [type, payload, sequence_id ?? null]
        );
        
        const eventId = eventRows[0].id;

        // Fan-out: Create delivery rows for all matching subscribers
        await client.query(
          `INSERT INTO deliveries (event_id, subscriber_id, sequence_id)
           SELECT $1, id, $2
           FROM subscribers
           WHERE status = 'active' AND $3 = ANY(event_types)
           ON CONFLICT (event_id, subscriber_id) DO NOTHING`,
          [eventId, sequence_id ?? null, type]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        app.log.error(error, 'Failed to process event fan-out');
      } finally {
        client.release();
      }
    } catch (err) {
      app.log.error(err, 'Failed to connect to db for fan-out');
    }
  });
}
