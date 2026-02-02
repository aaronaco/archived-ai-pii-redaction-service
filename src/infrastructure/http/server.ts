import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import type { StoreClient } from '../store/store-client.js';
import type { RedactionService } from '../../features/redaction/index.js';
import type { SessionService } from '../../features/session/risk-engine.service.js';

export interface ServerDependencies {
  store: StoreClient;
  redactionService: RedactionService;
  sessionService: SessionService;
}

export async function createServer(deps: ServerDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    trustProxy: true,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'] || request.headers['authorization'];
      if (apiKey) {
        return typeof apiKey === 'string' ? apiKey : apiKey[0] ?? request.ip;
      }
      return request.ip;
    },
    errorResponseBuilder: () => ({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
      statusCode: 429,
    }),
  });

  app.decorate('deps', deps);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const message = statusCode >= 500 ? 'Internal Server Error' : errorMessage;

    reply.status(statusCode).send({
      error: error instanceof Error ? error.name : 'Error',
      message,
      statusCode,
    });
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: ServerDependencies;
  }
}
