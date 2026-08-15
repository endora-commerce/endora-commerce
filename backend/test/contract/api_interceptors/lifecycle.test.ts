import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import type { ApiInterceptorRegistry } from '../../../src/http/interceptors/index.js';

/**
 * Feature 060 / US3 (T019) — deterministic ordering across builds and
 * lifecycle gating: a disabled module's interceptors are inert with no other
 * behavior change (FR-007/FR-008, SC-004/SC-005).
 */

const MODULE_A = 'interceptor_fixture_a';
const MODULE_B = 'interceptor_fixture_b';
const TARGET = 'GET /api/v1/admin/dictionary/countries';
const adminCookie = { b2b_session: 'stub-admin-session' };

/**
 * Registers the same two interceptors in the given call order. Both have
 * equal `order`, so execution must follow the (module, id) tie-break —
 * MODULE_A ('…_a') before MODULE_B ('…_b') — regardless of call order.
 */
function fixtures(callOrder: 'a-first' | 'b-first') {
  return (registry: ApiInterceptorRegistry) => {
    const regA = () =>
      registry.register({
        module: MODULE_A,
        id: 'tag',
        target: TARGET,
        phase: 'post',
        handler: async ({ payload }) => ({
          ...(payload as Record<string, unknown>),
          sequence: [...(((payload as { sequence?: string[] }).sequence) ?? []), 'a'],
        }),
      });
    const regB = () =>
      registry.register({
        module: MODULE_B,
        id: 'tag',
        target: TARGET,
        phase: 'post',
        handler: async ({ payload }) => ({
          ...(payload as Record<string, unknown>),
          sequence: [...(((payload as { sequence?: string[] }).sequence) ?? []), 'b'],
        }),
      });
    if (callOrder === 'a-first') {
      regA();
      regB();
    } else {
      regB();
      regA();
    }
  };
}

async function bootAndSample(callOrder: 'a-first' | 'b-first'): Promise<string[]> {
  const h = await setupBackendServer({ configureInterceptors: fixtures(callOrder) });
  const baselineEnabled = registryCache.enabledIds();
  registryCache.__setEnabledForTesting([...baselineEnabled, MODULE_A, MODULE_B]);
  try {
    const res = await h.app.inject({ method: 'GET', url: TARGET.split(' ')[1]!, cookies: adminCookie });
    return (res.json() as { sequence?: string[] }).sequence ?? [];
  } finally {
    // Restore the global enabled-set so no fixture id leaks into the next suite.
    registryCache.__setEnabledForTesting(baselineEnabled);
    await teardownBackendServer(h);
  }
}

describe('API interceptor ordering & lifecycle (feature 060 / US3)', () => {
  it('executes in deterministic (module, id) tie-break order across separate builds regardless of registration order', async () => {
    const first = await bootAndSample('a-first');
    const second = await bootAndSample('b-first');
    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(['a', 'b']);
  }, 120_000);

  describe('gating', () => {
    let h: BackendServerHandle;
    let baselineEnabled: string[] = [];

    beforeAll(async () => {
      h = await setupBackendServer({ configureInterceptors: fixtures('a-first') });
      baselineEnabled = registryCache.enabledIds();
      registryCache.__setEnabledForTesting([...baselineEnabled, MODULE_A, MODULE_B]);
    });

    afterAll(async () => {
      registryCache.__setEnabledForTesting(baselineEnabled);
      await teardownBackendServer(h);
    });

    it('a disabled module\'s interceptor is inert; re-enabling restores it (FR-008/SC-005)', async () => {
      const url = TARGET.split(' ')[1]!;
      const both = await h.app.inject({ method: 'GET', url, cookies: adminCookie });
      expect(both.json().sequence).toEqual(['a', 'b']);

      // Disable module A in the enabled-set cache (the same gate production
      // flips via the lifecycle orchestrator + pub/sub).
      const withA = registryCache.enabledIds();
      registryCache.__setEnabledForTesting(withA.filter((id) => id !== MODULE_A));
      const onlyB = await h.app.inject({ method: 'GET', url, cookies: adminCookie });
      expect(onlyB.json().sequence).toEqual(['b']);
      // Everything else about the response is unchanged.
      expect(onlyB.statusCode).toBe(200);
      expect(Array.isArray(onlyB.json().data)).toBe(true);

      registryCache.__setEnabledForTesting([...withA]);
      const restored = await h.app.inject({ method: 'GET', url, cookies: adminCookie });
      expect(restored.json().sequence).toEqual(['a', 'b']);
    });
  });
});
