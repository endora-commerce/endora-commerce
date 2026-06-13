import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Health endpoint. Pings Postgres, Redis, and Meilisearch; returns 200 with per-check
 * status when all are healthy, 503 otherwise. See spec FR-130 and tasks.md T038.
 */

export interface HealthDeps {
  pingDatabase: () => Promise<boolean>;
  pingRedis: () => Promise<boolean>;
  pingMeilisearch: () => Promise<boolean>;
}

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: z.boolean(),
    redis: z.boolean(),
    meilisearch: z.boolean(),
  }),
  version: z.string(),
  uptimeSeconds: z.number(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  app.get('/api/v1/_health', async (_req, reply) => {
    const [database, redis, meilisearch] = await Promise.all([
      runCheck(deps.pingDatabase),
      runCheck(deps.pingRedis),
      runCheck(deps.pingMeilisearch),
    ]);
    const allOk = database && redis && meilisearch;
    const body: HealthResponse = {
      status: allOk ? 'ok' : 'degraded',
      checks: { database, redis, meilisearch },
      version: process.env['npm_package_version'] ?? '0.0.0',
      uptimeSeconds: Math.round(process.uptime()),
    };
    // Return the reply (not a bare `reply.send()` in an async handler) — Fastify
    // v5 otherwise treats the resolved `undefined` as a second payload and the
    // onSend chain double-writes headers (ERR_HTTP_HEADERS_SENT → process crash).
    return reply.status(allOk ? 200 : 503).send(body);
  });
}

async function runCheck(fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}
