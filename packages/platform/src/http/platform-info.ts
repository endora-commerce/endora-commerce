import type { FastifyInstance } from 'fastify';
import { PlatformInfoSchema, type PlatformInfo } from '@endora-commerce/contracts';

import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';
import { PLATFORM_VERSION } from './platform-version.js';

/**
 * `GET /api/v1/admin/platform-info` — which release this instance runs, for the
 * admin header's version badge.
 *
 * **The platform's, not a module's**, for the reason the liveness probe is
 * (D-229): it reports on the platform itself, so there is no module whose
 * absence should take it away.
 *
 * **Not the liveness probe**, although that carries the same number. The probe
 * pings PostgreSQL, Redis and Meilisearch on every call and answers 503 while
 * one of them is down; a header rendered on every admin screen should neither
 * pay for three pings nor lose its badge because search is restarting. And the
 * probe is unauthenticated: a reader bound to it would break the day the
 * release number is judged too precise to hand to an anonymous caller.
 */

export interface PlatformInfoDeps {
  requireAdmin: RequireAdminFactory;
  /** Defaults to this package's own release; a test passes `null`. */
  version?: string | null;
}

export function registerPlatformInfoRoutes(app: FastifyInstance, deps: PlatformInfoDeps): void {
  const version = deps.version === undefined ? PLATFORM_VERSION : deps.version;

  /**
   * No permission code, deliberately — the same choice as
   * `/api/v1/admin/module-presence`. The badge sits in the header of every
   * screen, and the person a support conversation asks "which version are you
   * on?" is rarely the one holding `platform.modules.read`.
   */
  app.get(
    '/api/v1/admin/platform-info',
    {
      preHandler: deps.requireAdmin(),
      schema: { response: { 200: PlatformInfoSchema } },
    },
    async (): Promise<PlatformInfo> => ({ version }),
  );
}
