import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Feature 060 / US2 (T016) — an unexpected post-interceptor failure is
 * fail-closed: the client gets the standard 500 INTERNAL envelope. Log
 * attribution for failures is covered at the unit level in
 * test/unit/http/interceptors/dispatch.test.ts (fake logger capture).
 */

const FIXTURE_MODULE = 'interceptor_fixture';

describe('API interceptor post-phase failure (feature 060 / US2)', () => {
  let h: BackendServerHandle;
  let baselineEnabled: string[] = [];
  let ran = 0;

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'exploding-post',
          target: 'GET /api/v1/admin/dictionary/currencies',
          phase: 'post',
          handler: async () => {
            ran += 1;
            throw new Error('post interceptor exploded');
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

  it('fails the request with the standard 500 INTERNAL envelope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/dictionary/currencies',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(ran).toBe(1);
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(typeof body.error.requestId).toBe('string');
  });
});
