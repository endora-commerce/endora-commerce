import { describe, it, expect } from 'vitest';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * Parity check between the hand-maintained `REGISTERED_MANIFESTS` and
 * the build-time-generated `DISCOVERED_MANIFESTS`.
 *
 * If this test fails, a contributor either added a new lifecycle-shape
 * manifest to a module without rerunning the generator, or vice versa.
 * Fix by running:
 *
 *   pnpm --filter backend run manifest-index:generate
 *
 * The generator scans `backend/src/modules/<id>/manifest.ts` and only
 * includes files that match the shape `defineModuleManifest(...)` —
 * settings-only or other-shape manifests are left out.
 */
describe('manifest registry parity — REGISTERED_MANIFESTS vs DISCOVERED_MANIFESTS', () => {
  it('every manifest in the static registry has a matching entry in the generated index', () => {
    const registeredIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id).sort();
    const discoveredIds = DISCOVERED_MANIFESTS.map((e) => e.id).sort();
    expect(discoveredIds).toEqual(registeredIds);
  });

  it('the generated index references the same manifest object identity', () => {
    const byId = new Map(
      REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e.manifest]),
    );
    for (const entry of DISCOVERED_MANIFESTS) {
      expect(entry.manifest).toBe(byId.get(entry.id));
    }
  });
});
