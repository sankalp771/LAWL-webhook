import { FastifyInstance } from 'fastify';

import { pool } from '../../db/client';

export async function subscribeRoutes(app: FastifyInstance) {
  app.post('/subscribe', async (request, reply) => {
    const { url, event_types, secret } = request.body as {
      url: string;
      event_types: string[];
      secret?: string;
    };

    if (!url || !/^https?:\/\/.+/.test(url)) {
      return reply.status(400).send({ error: 'url must be a valid HTTP/HTTPS URL' });
    }

    if (!Array.isArray(event_types) || event_types.length === 0 || event_types.some(e => typeof e !== 'string')) {
      return reply.status(400).send({ error: 'event_types must be a non-empty array of strings' });
    }

    if (secret !== undefined && typeof secret !== 'string') {
      return reply.status(400).send({ error: 'secret must be a string' });
    }

    const { rows } = await pool.query<{ id: string; url: string; event_types: string[]; created_at: string; is_insert: boolean }>(
      `INSERT INTO subscribers (url, event_types, secret)
       VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET event_types = EXCLUDED.event_types
       RETURNING id, url, event_types, created_at, (xmax = 0) AS is_insert`,
      [url, event_types, secret ?? null]
    );

    const row = rows[0];
    return reply.status(row.is_insert ? 201 : 200).send({
      id: row.id,
      url: row.url,
      event_types: row.event_types,
      created_at: row.created_at
    });
  });
}
