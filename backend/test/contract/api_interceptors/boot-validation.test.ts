import { describe, expect, it } from 'vitest';
import { buildServer } from '../../../src/http/server.js';
import { ApiInterceptorRegistry } from '../../../src/http/interceptors/index.js';

/**
 * Feature 060 / US3 (T020) — fail-closed boot: a registration targeting a
 * nonexistent endpoint refuses startup with an error naming the module,
 * interceptor id, and target (FR-010/SC-007).
 *
 * Runs against a bare buildServer (the exact production wiring of the
 * validation hook) rather than the full backend harness: a full harness boot
 * that intentionally fails mid-`ready()` would leak its ORM/Redis
 * connections into the rest of the test fork, since only a successful setup
 * returns a teardown handle.
 */

const openApi = { title: 'test', version: 'test', serverUrl: 'http://localhost' };

describe('API interceptor boot validation (feature 060 / US3)', () => {
  it('refuses to boot when a registration targets an unknown endpoint', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'interceptor_fixture',
      id: 'typo-target',
      target: 'POST /api/v1/does-not-exist',
      phase: 'pre',
      handler: async () => {},
    });
    const app = await buildServer({
      sessionCookieSecret: 'test-secret-do-not-use-in-production',
      openApi,
      disableRateLimit: true,
      apiInterceptors: registry,
      modules: [
        async (a) => {
          a.post('/api/v1/orders', async () => ({}));
        },
      ],
    });
    try {
      await expect(app.ready()).rejects.toThrow(
        /interceptor_fixture[\s\S]*typo-target[\s\S]*POST \/api\/v1\/does-not-exist/,
      );
    } finally {
      await app.close();
    }
  });

  it('boots when every target resolves', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'interceptor_fixture',
      id: 'valid-target',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: async () => {},
    });
    const app = await buildServer({
      sessionCookieSecret: 'test-secret-do-not-use-in-production',
      openApi,
      disableRateLimit: true,
      apiInterceptors: registry,
      modules: [
        async (a) => {
          a.post('/api/v1/orders', async () => ({}));
        },
      ],
    });
    try {
      await expect(app.ready()).resolves.toBeDefined();
    } finally {
      await app.close();
    }
  });
});
