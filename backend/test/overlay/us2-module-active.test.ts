import { describe, it, expect } from 'vitest';
import { discoverOverlayModuleManifests } from '../../src/overlay/overlay-runtime.js';
import { REGISTERED_MANIFESTS } from '../../src/modules/_lifecycle/registered-manifests.js';

const EXAMPLE: NodeJS.ProcessEnv = { DEPLOYMENT: 'example' } as NodeJS.ProcessEnv;

/**
 * US2 scenarios 1 + 3 (SC-001, FR-004/FR-009): a client-only overlay module is
 * discovered, active and permissioned WITHOUT editing the shared core registry.
 *
 * The "and its route responds" half of this file has moved to
 * `test/integration/overlay/overlay-module-composition.test.ts`. It used to
 * mount the module's `plugin.ts` on a bare `Fastify()` with a stub
 * `requireAdmin` that always passed — which proved the plugin loaded and could
 * not see composition, gating, decoration or ownership. Since D-103 the module
 * composes through `composeModules`, so the route is exercised in the real
 * harness against a real session, and its off-state is exercised at all.
 */
describe('US2 — overlay-only module is active (T027)', () => {
  it('discovers the example_overlay module for DEPLOYMENT=example', async () => {
    const manifests = await discoverOverlayModuleManifests(EXAMPLE);
    const example = manifests.find((m) => m.id === 'example_overlay');
    expect(example).toBeDefined();
    expect(example?.manifest.permissions?.map((p) => p.code)).toContain('example_overlay:manage');
  });

  it('declares an activation control, so an operator can switch it off', async () => {
    // Principle XVII: an overlay module is not exempt from the operator axis.
    // It declared no `activation` block at all until D-103, so there was
    // nothing to switch and its off-state test had nothing to flip.
    const manifests = await discoverOverlayModuleManifests(EXAMPLE);
    const example = manifests.find((m) => m.id === 'example_overlay');
    expect(example?.manifest.activation).toEqual({
      settingCode: 'example_overlay.activation',
      default: true,
    });
  });

  it('does NOT appear in the shared core registry (FR-004)', () => {
    expect(REGISTERED_MANIFESTS.some((e) => e.manifest.id === 'example_overlay')).toBe(false);
  });
});
