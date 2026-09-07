import { describe, expect, it } from 'vitest';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { buildStaticRegistry } from '@endora-commerce/platform/lifecycle';

/**
 * Integration test for SC-006 — boot validation budget (US4).
 *
 * Manifest loading + cycle detection + duplicate-id check across 50
 * manifests MUST complete in under 500 ms.
 *
 * Tested against the static-registry build path (what composition.ts
 * uses); the filesystem loader is gated by Node's import-cache and
 * carries similar O(N) cost characteristics.
 */

describe('Boot — validation perf budget (integration)', () => {
  it('builds a 50-module registry with cycle + duplicate checks in under 500 ms', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      manifest: defineModuleManifest({
        id: `fixture_perf_${i}`,
        name: `Perf ${i}`,
        version: '1.0.0',
        dependencies: i > 0 ? [`fixture_perf_${i - 1}`] : [],
      }),
    }));

    const start = Date.now();
    const reg = buildStaticRegistry(entries);
    const duration = Date.now() - start;

    expect(reg.modules.size).toBe(50);
    expect(reg.graph.hasCycle()).toBeNull();
    expect(duration).toBeLessThan(500);
  });
});
