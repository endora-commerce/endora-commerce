import type { FastifyInstance } from 'fastify';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { z } from 'zod';

/**
 * The liveness and readiness probe — **the platform's, not a module's**
 * (D-229).
 *
 * It moved here from `health_checks`, which was then dissolved. The module owned
 * nothing a module owns: no entity, no migration, no permission, no i18n
 * bundle, no palette action, no Setting. What it had was this route and three
 * closures over host values, and everything those closures reach — `orm`,
 * `redis`, an address — is already platform- or kernel-owned.
 *
 * **Why the move rather than a default-set entry.** `endora new instance`
 * writes the closure over the modules declaring `activation.nonDeactivatable`;
 * `health_checks` declared no `activation` block at all, so no scaffolded
 * instance installed it, and `deploy/compose.prod.yml` healthchecks this exact
 * path on the `backend` service with the storefront waiting on
 * `service_healthy`. An instance's API container therefore never became
 * healthy and its storefront never started. Naming the module in the
 * scaffolder's set would have replaced a derivation with a derivation plus one
 * hand-written exception (D-100), and left the withdrawal open besides:
 * `assertDeactivatable` returns early for a module carrying no activation
 * block, so `module:uninstall health_checks` was accepted and an operator could
 * take the liveness route off a running instance with one command.
 *
 * **And the exemption it used to need is now structural.** The module's own
 * comment argued the probes must never be gated: *a liveness probe that answers
 * 503 because its module is absent makes the orchestrator kill the container,
 * restart it, get 503 again, and repeat — and nothing stays up long enough to
 * serve the surface that would switch the module back on.* That reasoning was
 * correct and stopped one case short of the never-installed one, where the 503
 * is a 404 and there is no route to exempt. A route the platform registers has
 * no presence axis to be gated on, which is what `ctx.ungatedRoutes`' reason
 * paragraph had been asking for.
 *
 * An instance serves `/api/v1/_health` because it is an Endora instance.
 *
 * Not exported from `http/index.ts` on purpose (T1-B): the platform's own app
 * composition is the only caller, no consumer names it, and publishing a
 * subpath for a route nobody imports would widen the host surface for nothing.
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

/** What the probes read from a composed application. */
export interface HealthProbeSources {
  /** Kernel-owned. The probe pings on the shared EM. */
  readonly orm: MikroORM;
  /** Platform-owned. Absent in a deployment that runs without Redis. */
  readonly redis: Redis | undefined;
}

/**
 * The three probes, over the values a composition already holds. Carried across
 * from the dissolved module's `registerModule` unchanged.
 */
export function platformHealthProbes(sources: HealthProbeSources): HealthDeps {
  return {
    pingDatabase: async () => {
      await sources.orm.em.getConnection().execute('select 1');
      return true;
    },
    // No Redis in this deployment is not "healthy by omission": the endpoint
    // reports what is reachable, and an absent client is not.
    pingRedis: async () =>
      sources.redis !== undefined && (await sources.redis.ping()) === 'PONG',
    pingMeilisearch: async () => {
      const base = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    },
  };
}

/**
 * The probe as a plugin, ready to go into a composition's `modules` array.
 *
 * There are two composition roots — `composeApp` and the test kit's
 * `composeTestServer` — and each assembles that array itself. They both call
 * this, for the reason the test kit already gives about
 * `registerRequestScopeHook`: one factory with two call sites is a shared
 * seam, two hand-written registrations are a drift waiting to happen. The
 * module this replaced existed in production and nowhere else for exactly that
 * reason, its route having been wired by an inline plugin in one root only.
 */
export function healthRoutePlugin(
  sources: HealthProbeSources,
): (app: FastifyInstance) => Promise<void> {
  const deps = platformHealthProbes(sources);
  return async (app) => {
    await registerHealthRoutes(app, deps);
  };
}

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
