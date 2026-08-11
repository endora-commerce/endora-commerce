import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { healthResponseSchema } from '../../../src/modules/health_checks/routes.js';

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
});
