import type { MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

import { registerHealthRoutes, type HealthDeps } from './routes.js';

/**
 * The Health Checks module's backend entry point — converted to feature 072's
 * `registerModule` contract (T080).
 *
 * This module had no `plugin.ts` at all (quickstart shape D): it shipped the
 * route factory and `composition.ts` supplied the three probes from an inline
 * `healthPlugin`, which is why `/api/v1/_health` existed in production and
 * nowhere else — the test harness is a second composition root and never wired
 * it, so the endpoint orchestrators depend on had no test. Giving the module
 * its own registration seam fixes both: the probes are registrations, and both
 * roots get the route by composing the module.
 */

/** What `health_checks` resolves from the container, and the name it owns. */
export interface HealthChecksCradle {
  /** Kernel-owned. The probe pings on the shared EM, exactly as the inline plugin did. */
  readonly orm: MikroORM;
  /** Platform-owned. Absent in a deployment that runs without Redis. */
  readonly redis: Redis | undefined;
  /** The three liveness probes, owned by this module. */
  readonly healthCheckProbes: HealthDeps;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    healthCheckProbes: ctx
      .asFunction(
        ({ orm, redis }: HealthChecksCradle): HealthDeps => ({
          pingDatabase: async () => {
            await orm.em.getConnection().execute('select 1');
            return true;
          },
          // No Redis in this deployment is not "healthy by omission": the
          // endpoint reports what is reachable, and an absent client is not.
          pingRedis: async () => redis !== undefined && (await redis.ping()) === 'PONG',
          pingMeilisearch: async () => {
            const base = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
            const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
            return res.ok;
          },
        }),
      )
      .singleton(),
  });

  // D-36b — the probes are never gated. Feature 072's conversion briefly put
  // `/api/v1/_health` behind `defineModuleRoutes`, which the inline plugin it
  // replaced was not: a liveness probe that answers 503 because its module is
  // absent makes the orchestrator kill the container, restart it, get 503
  // again, and repeat — and nothing stays up long enough to serve the surface
  // that would switch the module back on.
  ctx.ungatedRoutes(
    'Liveness and readiness probes: an orchestrator reads a 503 here as "kill this ' +
      'container", so gating them on module presence turns a switched-off module into a ' +
      'restart loop no operator surface can escape.',
    async (app) => {
      await registerHealthRoutes(app, ctx.cradle<HealthChecksCradle>().healthCheckProbes);
    },
  );
}


/**
 * This module owns **no persisted entity**, and says so with an empty array
 * rather than by omission (D-168).
 *
 * The two are not the same thing to the platform. When the package is
 * *installed*, `src/packages/package-runtime.ts` reads `exported['entities']`
 * and answers a missing export with `[]` — so "this module has no table" and
 * "somebody forgot the array" arrive at the host as the same silence, and the
 * only symptom of the second is a query against a table nobody created. The
 * declaration is what makes the first case a statement.
 *
 * A first entity added here goes in this array in the same merge request, and
 * `test/unit/packages/module-package-entity-surface.test.ts` is what says so.
 */
export const entities: readonly never[] = [];
