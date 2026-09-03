import { describe, it, expect } from 'vitest';
import { OVERRIDE_MANIFEST } from '../../src/overlay/override-manifest.core.generated.js';

// US3 (SC-006 / SC-003): the committed bare-core artifact proves resolution ran
// and found nothing to add — a non-empty file with an empty array, distinct
// from "resolution never ran".
describe('US3 — bare-core override manifest (T036)', () => {
  it('the committed core artifact names core and adds no module', () => {
    expect(OVERRIDE_MANIFEST.deployment).toBe('core');
    expect(OVERRIDE_MANIFEST.generatedFrom.overlayRoot).toBeNull();
    expect(OVERRIDE_MANIFEST.newModules).toEqual([]);
  });

  it('carries no field a v2 build cannot answer truthfully', () => {
    // `overrides` and `generatedFrom.coreRoot` are retired with file shadowing
    // (feature 103, D-201). Asserted on the committed artefact rather than on
    // the type, because a regeneration is what has to drop them.
    const manifest = OVERRIDE_MANIFEST as unknown as Record<string, unknown>;
    expect(Object.keys(manifest).sort()).toEqual(['deployment', 'generatedFrom', 'newModules']);
    expect(Object.keys(manifest['generatedFrom'] as object)).toEqual(['overlayRoot']);
  });
});
