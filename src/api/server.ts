import Fastify from 'fastify';

import { closePool, pingDatabase, runSchema } from '../db/client';

export function buildServer() {
  const app = Fastify({
    logger: true,
  });

  app.get('/health', async () => {
    await pingDatabase();

    return {
      status: 'ok',
      db: 'connected',
    };
  });

  return app;
}

async function start() {
  await runSchema();

  const app = buildServer();

  try {
    await app.listen({
      host: '0.0.0.0',
      port: Number(process.env.PORT ?? 3000),
    });
  } catch (error) {
    app.log.error(error);
    await closePool();
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await closePool();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();