import { describe, it, expect } from 'vitest';
import { assertNoConflicts } from '../../src/overlay/conflict-policy.js';
import { OverrideConflictError } from '../../src/overlay/errors.js';
import type { OverlayContribution } from '../../src/overlay/types.js';

// US3 (FR-007 / SC-005): the build-path conflict gate `assertNoConflicts` —
// invoked inside `resolveOverlay` before a manifest is emitted — fails the
// build (throws) when two overlays target one core unit. No silent last-wins.
const contribution = (overlayPath: string): OverlayContribution => ({
  moduleId: 'catalog',
  kind: 'route',
  relPath: 'routes.admin.ts',
  overlayPath,
  corePath: '/core/catalog/routes.admin.ts',
  interfaceRelPath: null,
});

describe('US3 — conflicting overrides fail the build (T035)', () => {
  it('throws OverrideConflictError naming both contenders', () => {
    expect(() =>
      assertNoConflicts([contribution('/apps/a/catalog/routes.admin.ts'), contribution('/apps/b/catalog/routes.admin.ts')]),
    ).toThrow(OverrideConflictError);
  });
});
