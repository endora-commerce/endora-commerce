import type { MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../composition/index.js';
import { healthResponseSchema, healthRoutePlugin, registerHealthRoutes } from './health.js';

/**
 * D-229 — the liveness probe is served because this is an Endora instance.
 *
 * The done-when this file holds is the ruling's: **a composed application
 * serves `/api/v1/_health` with no `health_checks` module in the set at all**.
 * There is no such module any more, so the application below composes none —
 * `modules` carries the platform's own plugin and nothing else, which is
 * exactly the shape a scaffolded instance had when the route answered 404.
 *
 * The probes are stubbed rather than pointed at real infrastructure: the rule
 * under test is the conjunction and the failure mode of a probe that throws,
 * and both are decidable without a database. What a real deployment answers is
 * `backend/test/contract/http/health-endpoint.test.ts`.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serveProbes(deps: {
  pingDatabase: () => Promise<boolean>;
  pingRedis: () => Promise<boolean>;
  pingMeilisearch: () => Promise<boolean>;
}): Promise<FastifyInstance> {
  app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: { title: 'health probe test', version: 'test', serverUrl: 'http://localhost' },
    disableRateLimit: true,
    modules: [
      async (instance) => {
        await registerHealthRoutes(instance, deps);
      },
    ],
  });
  await app.ready();
  return app;
}

const up = async (): Promise<boolean> => true;
const down = async (): Promise<boolean> => false;

describe('the platform serves the liveness probe with no module composed', () => {
  it('registers the route — a handler, not the not-found handler', async () => {
    const served = await serveProbes({
      pingDatabase: up,
      pingRedis: up,
      pingMeilisearch: up,
    });

    const res = await served.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(res.statusCode).not.toBe(404);
  });

  it('answers 200 and `ok` when every probe passes', async () => {
    const served = await serveProbes({
      pingDatabase: up,
      pingRedis: up,
      pingMeilisearch: up,
    });

    const res = await served.inject({ method: 'GET', url: '/api/v1/_health' });
    const body = healthResponseSchema.parse(res.json());

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ database: true, redis: true, meilisearch: true });
  });

  it('answers 503 and `degraded` when one probe reports false', async () => {
    const served = await serveProbes({
      pingDatabase: up,
      pingRedis: down,
      pingMeilisearch: up,
    });

    const res = await served.inject({ method: 'GET', url: '/api/v1/_health' });
    const body = healthResponseSchema.parse(res.json());

    expect(res.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis).toBe(false);
  });

  /**
   * `runCheck`'s `catch`, which is the second load-bearing line in the file it
   * moved from: an unreachable dependency is a `false` in the payload, never a
   * 500 from the probe itself. An orchestrator reads a 500 as "this process is
   * broken" and a 503 as "not ready yet", and the difference is whether it
   * keeps the container.
   */
  it('turns a throwing probe into a false rather than a 500', async () => {
    const served = await serveProbes({
      pingDatabase: up,
      pingRedis: async () => {
        throw new Error('ECONNREFUSED');
      },
      pingMeilisearch: up,
    });

    const res = await served.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(res.statusCode).toBe(503);
    expect(healthResponseSchema.parse(res.json()).checks.redis).toBe(false);
  });

  /**
   * The route is registered exactly once, and it is a `GET` — which is what an
   * orchestrator and a load balancer both issue. `HEAD` is beside it because
   * Fastify derives one from every `GET` (`exposeHeadRoutes`), and it is
   * asserted rather than filtered out so that the day that default changes,
   * this says so instead of silently agreeing.
   *
   * A second registration would not reach this assertion at all — it is
   * `FST_ERR_DUPLICATE_ROUTE` from `app.ready()` — so what this case adds is
   * the other direction: one call to `healthRoutePlugin` produces one route,
   * not zero, in an application that composes no module.
   */
  it('registers `/api/v1/_health` once per application', async () => {
    const routes: string[] = [];
    app = await buildServer({
      sessionCookieSecret: 'test-secret-do-not-use-in-production',
      openApi: { title: 'health probe test', version: 'test', serverUrl: 'http://localhost' },
      disableRateLimit: true,
      modules: [
        (instance): void => {
          instance.addHook('onRoute', (route) => {
            if (route.url === '/api/v1/_health') routes.push(route.method as string);
          });
        },
        healthRoutePlugin({
          // The plugin only closes over these; the probes below are never run
          // because nothing requests the route in this case.
          orm: undefined as unknown as MikroORM,
          redis: undefined as unknown as Redis | undefined,
        }),
      ],
    });
    await app.ready();

    expect(routes).toEqual(['GET', 'HEAD']);
  });
});
