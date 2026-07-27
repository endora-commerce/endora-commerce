import { describe, it, expect } from 'vitest';
import { resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import {
  buildOverrideManifest,
  serializeManifestModule,
} from '../../src/overlay/override-manifest.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

// US3 (FR-006 / SC-003): identical inputs ⇒ byte-identical emitted module.
describe('US3 — override-manifest determinism (T034)', () => {
  function emit(): string {
    const overlayPath = overlayRoot('overlay-good');
    const resolution = resolveOverlay({
      coreRoot: coreSampleRoot,
      overlayRoot: overlayPath,
      deployment: 'acme',
    });
    const manifest = buildOverrideManifest({
      deployment: 'acme',
      coreRoot: coreSampleRoot,
      overlayRoot: overlayPath,
      resolution,
      base: coreSampleRoot,
    });
    return serializeManifestModule(manifest, './types.js');
  }

  it('regenerating the emitted manifest module twice yields identical bytes', () => {
    expect(emit()).toEqual(emit());
  });
});
