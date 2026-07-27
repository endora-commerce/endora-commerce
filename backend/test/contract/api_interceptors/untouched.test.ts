import { describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Feature 060 / US1 (T012, also backs SC-002/T031) — endpoints that no
 * interceptor targets behave byte-identically whether or not interceptors are
 * registered elsewhere. Two boots of the same harness: baseline (zero
 * registrations) vs. registrations on an unrelated endpoint.
 */

const SAMPLED: Array<{ method: 'GET'; url: string; cookies?: Record<string, string> }> = [
  { method: 'GET', url: '/api/v1/i18n/config' },
  {
    method: 'GET',
    url: '/api/v1/admin/dictionary/countries',
    cookies: { b2b_session: 'stub-admin-session' },
  },
];

/**
 * Each harness boot truncates + reseeds the database, so row timestamps (and
 * only row timestamps) legitimately differ between the two boots. Strip them
 * before the byte-level comparison — everything else must match exactly.
 */
function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'createdAt' || k === 'updatedAt') continue;
      out[k] = stripVolatile(v);
    }
    return out;
  }
  return value;
}

async function sample(configure?: Parameters<typeof setupBackendServer>[0]) {
  const h = await setupBackendServer(configure ?? {});
  const baselineEnabled = registryCache.enabledIds();
  if (configure?.configureInterceptors) {
    registryCache.__setEnabledForTesting([...baselineEnabled, 'interceptor_fixture']);
  }
  try {
    const results = [];
    for (const req of SAMPLED) {
      const res = await h.app.inject(req);
      results.push({ statusCode: res.statusCode, body: stripVolatile(res.json()) });
    }
    return results;
  } finally {
    // Restore the global enabled-set so no fixture id leaks into the next suite.
    registryCache.__setEnabledForTesting(baselineEnabled);
    await teardownBackendServer(h);
  }
}

describe('untargeted endpoints are untouched (feature 060 / US1, SC-002)', () => {
  it('produces identical responses with and without unrelated interceptors registered', async () => {
    const baseline = await sample();
    const withInterceptors = await sample({
      configureInterceptors: (registry) => {
        registry.register({
          module: 'interceptor_fixture',
          id: 'unrelated-pre',
          target: 'POST /api/v1/admin/dictionary/countries',
          phase: 'pre',
          handler: async () => {},
        });
        registry.register({
          module: 'interceptor_fixture',
          id: 'unrelated-post',
          target: 'POST /api/v1/admin/dictionary/countries',
          phase: 'post',
          handler: async () => undefined,
        });
      },
    });
    expect(withInterceptors).toEqual(baseline);
  }, 120_000);
});
