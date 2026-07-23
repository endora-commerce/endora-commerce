import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiInterceptorListSchema } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Feature 060 / US3 (T021) — read-only diagnostics: the execution plan is
 * discoverable per contracts/admin-api.md, with live moduleEnabled state.
 */

const FIXTURE_MODULE = 'interceptor_fixture';
const TARGET = 'GET /api/v1/admin/dictionary/countries';

describe('GET /api/v1/admin/api-interceptors (feature 060 / US3)', () => {
  let h: BackendServerHandle;
  let baselineEnabled: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'post-enrich',
          target: TARGET,
          phase: 'post',
          order: 20,
          handler: async () => undefined,
        });
        registry.register({
          module: FIXTURE_MODULE,
          id: 'pre-check',
          target: TARGET,
          phase: 'pre',
          order: 10,
          handler: async () => {},
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

  it('lists registrations in execution order with live moduleEnabled state', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/api-interceptors',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = apiInterceptorListSchema.parse(res.json());
    const fixtureItems = body.items.filter((i) => i.module === FIXTURE_MODULE);
    expect(fixtureItems).toEqual([
      { target: TARGET, phase: 'pre', order: 10, module: FIXTURE_MODULE, id: 'pre-check', moduleEnabled: true },
      { target: TARGET, phase: 'post', order: 20, module: FIXTURE_MODULE, id: 'post-enrich', moduleEnabled: true },
    ]);
  });

  it('reflects a disabled module live', async () => {
    const withFixture = registryCache.enabledIds();
    registryCache.__setEnabledForTesting(withFixture.filter((id) => id !== FIXTURE_MODULE));
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/api-interceptors',
        cookies: { b2b_session: 'stub-admin-session' },
      });
      const body = apiInterceptorListSchema.parse(res.json());
      expect(body.items.filter((i) => i.module === FIXTURE_MODULE).every((i) => !i.moduleEnabled)).toBe(true);
    } finally {
      registryCache.__setEnabledForTesting([...withFixture]);
    }
  });

  it('requires an admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/api-interceptors' });
    expect(res.statusCode).toBe(401);
  });
});
