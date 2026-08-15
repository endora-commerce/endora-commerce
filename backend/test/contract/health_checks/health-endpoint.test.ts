import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { healthResponseSchema } from '../../../src/modules/health_checks/routes.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Contract — `/api/v1/_health` (feature 072, T080; FR-130).
 *
 * The endpoint has existed since feature 001 and has never had a test, because
 * it was registered by an inline plugin in `composition.ts` and the test
 * harness is a different composition root. Converting `health_checks` to
 * `registerModule` is what makes it reachable from both — so this file is the
 * conversion's acceptance criterion, and it fails with a 404 against the
 * pre-conversion harness.
 *
 * What is asserted is the endpoint's *rule*, not a green environment: the
 * status code follows the conjunction of the three probes. Redis and
 * Meilisearch may legitimately be down on a machine running a targeted suite;
 * PostgreSQL cannot, because the harness just seeded it.
 */
describe('health_checks — GET /api/v1/_health', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is registered — the harness composes the module, so the route exists', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
    expect(res.statusCode).not.toBe(404);
  });

  it('answers with the health envelope', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
    const parsed = healthResponseSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(res.json())).toBe(true);
  });

  it('reports the database as reachable — the harness just seeded it', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
    expect(res.json().checks.database).toBe(true);
  });

  it('is 200 exactly when every probe passes, 503 otherwise', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
    const body = healthResponseSchema.parse(res.json());
    const allOk = body.checks.database && body.checks.redis && body.checks.meilisearch;
    expect(res.statusCode).toBe(allOk ? 200 : 503);
    expect(body.status).toBe(allOk ? 'ok' : 'degraded');
  });

  /**
   * D-36b — the probe is never gated on module presence.
   *
   * Converting this module (feature 072, T080) put `/api/v1/_health` behind
   * `defineModuleRoutes`, which the inline plugin it replaced was not. A
   * liveness probe that answers 503 because its module is absent makes the
   * orchestrator kill the container, restart it, get 503 again and repeat —
   * and nothing stays up long enough to serve the surface that would switch
   * the module back on. A surface that reports on the platform cannot be gated
   * on a part of the platform without becoming circular.
   */
  describe('while the module is absent', () => {
    const enabled = registryCache.enabledIds();

    afterEach(() => {
      registryCache.__setEnabledForTesting(enabled);
    });

    it('still answers the health envelope when the operator deactivated it', async () => {
      registryCache.__setEnabledForTesting(enabled, { deactivated: ['health_checks'] });
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
      expect(healthResponseSchema.safeParse(res.json()).success, JSON.stringify(res.json())).toBe(
        true,
      );
    });

    it('still answers when the module is not available on this platform', async () => {
      registryCache.__setEnabledForTesting(enabled.filter((id) => id !== 'health_checks'));
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
      const body = healthResponseSchema.safeParse(res.json());
      expect(body.success, JSON.stringify(res.json())).toBe(true);
      // Never the gate's answer: that 503 carries `Retry-After` and a
      // MODULE_DISABLED envelope, which an orchestrator reads as "kill me".
      expect(res.headers['retry-after']).toBeUndefined();
    });
  });
});
