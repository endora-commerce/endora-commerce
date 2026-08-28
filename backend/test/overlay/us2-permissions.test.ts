import { describe, it, expect } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../src/lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import { manifest as exampleOverlayManifest } from '../../src/apps/example/modules/example_overlay/manifest.js';

// US2 scenario 3 (FR-009 / T033): the overlay module's permission appears in the
// catalogue for its deployment (resolved registry = core + overlay) and NOT for
// bare core — proving per-deployment permission integration.
describe('US2 — overlay module permissions are per-deployment (T029/T033)', () => {
  it('is absent from the bare-core catalogue', () => {
    const core = new Set(listAssignablePermissionCodes(REGISTERED_MANIFESTS));
    expect(core.has('example_overlay:manage')).toBe(false);
  });

  it('is assignable once the overlay module is in the resolved registry', () => {
    const resolved = new Set(
      listAssignablePermissionCodes([
        ...REGISTERED_MANIFESTS,
        { manifest: exampleOverlayManifest },
      ]),
    );
    expect(resolved.has('example_overlay:manage')).toBe(true);
  });
});
