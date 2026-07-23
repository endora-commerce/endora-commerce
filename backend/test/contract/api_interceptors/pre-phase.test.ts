import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Feature 060 / US1 (T009) — pre-phase interception on an endpoint owned by
 * ANOTHER module (`dictionaries`), registered by a fixture module with zero
 * changes to the owning module's source.
 */

const FIXTURE_MODULE = 'interceptor_fixture';
const TARGET = 'POST /api/v1/admin/dictionary/countries';
const adminCookie = { b2b_session: 'stub-admin-session' };

describe('API interceptor pre phase (feature 060 / US1)', () => {
  let h: BackendServerHandle;
  let preRan = 0;
  let bodySeenByInterceptor: unknown;

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: FIXTURE_MODULE,
          id: 'enrich-country-label',
          target: TARGET,
          phase: 'pre',
          handler: async ({ body }) => {
            preRan += 1;
            bodySeenByInterceptor = structuredClone(body);
            return { body: { ...(body as Record<string, unknown>), label: 'Set By Interceptor' } };
          },
        });
      },
    });
    // The fixture module id is not a real registered module; enable it in the
    // in-process lifecycle cache so the dispatch gate lets it run.
    registryCache.__setEnabledForTesting([...registryCache.enabledIds(), FIXTURE_MODULE]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('runs before the endpoint logic and its body adjustment reaches the owning module', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      cookies: adminCookie,
      payload: {
        code: 'ZZ',
        alpha3Code: 'ZZZ',
        numericCode: '999',
        label: 'Original Label',
        region: 'Europe',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(preRan).toBe(1);
    // The interceptor observed the client's validated body...
    expect((bodySeenByInterceptor as { label: string }).label).toBe('Original Label');
    // ...and the endpoint persisted the interceptor-adjusted value.
    expect(res.json().data.label).toBe('Set By Interceptor');
  });

  it('never runs when the route guard rejects the request (FR-006)', async () => {
    const before = preRan;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      payload: {
        code: 'ZY',
        alpha3Code: 'ZZY',
        numericCode: '998',
        label: 'No Session',
        region: 'Europe',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(preRan).toBe(before);
  });

  it('never runs for a schema-invalid request — it only ever sees validated input (FR-003)', async () => {
    const before = preRan;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/dictionary/countries',
      cookies: adminCookie,
      payload: { label: 'Missing everything' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(preRan).toBe(before);
  });
});
