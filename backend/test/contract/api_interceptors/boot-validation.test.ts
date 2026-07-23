import { describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer } from '../../helpers/test-server.js';

/**
 * Feature 060 / US3 (T020) — fail-closed boot: a registration targeting a
 * nonexistent endpoint refuses startup with an error naming the module,
 * interceptor id, and target (FR-010/SC-007). `app.ready()` runs inside
 * setupBackendServer, so the whole boot rejects.
 */

describe('API interceptor boot validation (feature 060 / US3)', () => {
  it('refuses to boot when a registration targets an unknown endpoint', async () => {
    let handle: Awaited<ReturnType<typeof setupBackendServer>> | undefined;
    let error: Error | undefined;
    try {
      handle = await setupBackendServer({
        configureInterceptors: (registry) => {
          registry.register({
            module: 'interceptor_fixture',
            id: 'typo-target',
            target: 'POST /api/v1/does-not-exist',
            phase: 'pre',
            handler: async () => {},
          });
        },
      });
    } catch (err) {
      error = err as Error;
    } finally {
      if (handle) await teardownBackendServer(handle);
    }
    expect(handle).toBeUndefined();
    expect(error).toBeDefined();
    expect(error?.message).toContain('interceptor_fixture');
    expect(error?.message).toContain('typo-target');
    expect(error?.message).toContain('POST /api/v1/does-not-exist');
  }, 120_000);
});
