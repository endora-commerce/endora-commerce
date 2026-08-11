import type { MikroORM } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { ModuleContext } from '../../kernel/index.js';

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

/** Every entity this module owns — none. It reads liveness, it stores nothing. */
export const entities = [] as const;

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

  ctx.routes(async (app) => {
    await registerHealthRoutes(app, ctx.cradle<HealthChecksCradle>().healthCheckProbes);
  });
}
