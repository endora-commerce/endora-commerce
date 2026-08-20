import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Feature 060 / US2 (T015) — post-phase interception: reshaping successful
 * responses of an endpoint owned by another module; error responses are
 * never touched.
 */

const FIXTURE_MODULE = 'interceptor_fixture';
const TARGET = 'GET /api/v1/admin/dictionary/countries';
const adminCookie = { b2b_session: 'stub-admin-session' };

describe('API interceptor post phase (feature 060 / US2)', () => {
  let h: BackendServerHandle;
  let baselineEnabled: string[] = [];
  let postRan = 0;

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'first-enricher',
          target: TARGET,
          phase: 'post',
          order: 10,
          handler: async ({ payload }) => {
            postRan += 1;
            return { ...(payload as Record<string, unknown>), enrichmentChain: ['first'] };
          },
        });
        registry.register({
          module: FIXTURE_MODULE,
          id: 'second-enricher',
          target: TARGET,
          phase: 'post',
          order: 20,
          handler: async ({ payload }) => {
            postRan += 1;
            const p = payload as { enrichmentChain?: string[] };
            // Later interceptors see earlier interceptors' output (last-writer-wins chain).
            return { ...p, enrichmentChain: [...(p.enrichmentChain ?? []), 'second'] };
          },
        });
        registry.register({
          module: FIXTURE_MODULE,
          id: 'no-op-enricher',
          target: TARGET,
          phase: 'post',
          order: 30,
          handler: async () => {
            postRan += 1;
            return undefined; // undefined ⇒ payload unchanged
          },
        });
      },
    });
    baselineEnabled = registryCache.enabledIds();
    registryCache.__setEnabledForTesting([...baselineEnabled, FIXTURE_MODULE]);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(baselineEnabled);
    await teardownBackendServer(h);
  });

  it('reshapes the successful response, composing interceptors in order', async () => {
    postRan = 0;
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/countries',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enrichmentChain).toEqual(['first', 'second']);
    // The original payload is still there — reshaping extends, not replaces.
    expect(Array.isArray(body.data)).toBe(true);
    expect(postRan).toBe(3);
  });

  it('never runs on error responses — the owning module error passes through untouched (FR-004)', async () => {
    postRan = 0;
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/countries',
      // No admin session → 401 from the route guard.
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().enrichmentChain).toBeUndefined();
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    expect(postRan).toBe(0);
  });
});
