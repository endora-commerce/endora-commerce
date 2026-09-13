import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { healthResponseSchema } from '@endora-commerce/platform/composition';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * Contract — `/api/v1/_health` against a real composed deployment.
 *
 * The route is the **platform's** since D-229, not a module's, and this file
 * moved out of `test/contract/health_checks/` with it. What it asserts is the
 * endpoint's *rule* — the status code follows the conjunction of the three
 * probes — against the composition a served instance runs, not a green
 * environment: Redis and Meilisearch may legitimately be down on a machine
 * running a targeted suite; PostgreSQL cannot, because the harness just seeded
 * it.
 *
 * The rule's edges — a probe that reports `false`, a probe that throws — are
 * `packages/platform/src/http/health.test.ts`, where they are decidable without
 * infrastructure. This file exists for the one thing that one cannot show: that
 * the deployment's own composition serves the route.
 */
describe('GET /api/v1/_health', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * D-229's done-when, asserted rather than described: the probe answers with
   * **no `health_checks` module in the deployment at all**. The module was
   * dissolved, so this expectation is what stops the pair below from quietly
   * becoming a tautology if one is ever re-added — a route that answers because
   * a module registered it is not the property this feature bought.
   */
  it('is served by a deployment that has no health module', () => {
    expect(DISCOVERED_MANIFESTS.map((entry) => entry.id)).not.toContain('health_checks');
  });

  it('is registered — the platform composes the route, so it exists', async () => {
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
   * The gate's 503 is a different answer from the probe's, and an orchestrator
   * cannot tell them apart from the status alone — it reads either as "kill this
   * container". Before D-229 the module's route carried a `ctx.ungatedRoutes`
   * exemption to keep the gate off it; now there is no module and therefore no
   * gate, and this is what says so from the outside: a `MODULE_DISABLED`
   * envelope carries `Retry-After`, and the probe's never does.
   */
  it('never answers the gate’s refusal — no `Retry-After` on any verdict', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_health' });
    expect(res.headers['retry-after']).toBeUndefined();
  });
});
