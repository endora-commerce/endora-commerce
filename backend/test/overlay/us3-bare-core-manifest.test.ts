import { describe, it, expect } from 'vitest';
import { OVERRIDE_MANIFEST } from '../../src/overlay/override-manifest.core.generated.js';
import { hasOverrides } from '../../src/overlay/override-manifest.js';

// US3 (SC-006 / SC-003): the committed bare-core artifact proves resolution ran
// and found nothing to override — a non-empty file with empty arrays, distinct
// from "resolution never ran".
describe('US3 — bare-core override manifest (T036)', () => {
  it('the committed core artifact has empty overrides + newModules', () => {
    expect(OVERRIDE_MANIFEST.deployment).toBe('core');
    expect(OVERRIDE_MANIFEST.generatedFrom.overlayRoot).toBeNull();
    expect(OVERRIDE_MANIFEST.overrides).toEqual([]);
    expect(OVERRIDE_MANIFEST.newModules).toEqual([]);
    expect(hasOverrides(OVERRIDE_MANIFEST)).toBe(false);
  });
});
