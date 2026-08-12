import { describe, it, expect } from 'vitest';
import { resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import {
  buildOverrideManifest,
  hasOverrides,
  serializeManifestJson,
} from '../../src/overlay/override-manifest.js';
import { coreSampleRoot, overlayRoot } from './_fixtures.js';

const base = coreSampleRoot; // deterministic repo-relative base for the test

function manifestFor(overlayName: string | null) {
  const overlayPath = overlayName === null ? null : overlayRoot(overlayName);
  const resolution = resolveOverlay({
    coreRoot: coreSampleRoot,
    overlayRoot: overlayPath,
    deployment: overlayName === null ? null : 'acme',
  });
  return buildOverrideManifest({
    deployment: overlayName === null ? null : 'acme',
    coreRoot: coreSampleRoot,
    overlayRoot: overlayPath,
    resolution,
    base,
  });
}

describe('override-manifest — emit shape & determinism (T010, FR-005/FR-006)', () => {
  it('bare-core manifest has empty overrides + newModules (SC-006)', () => {
    const m = manifestFor(null);
    expect(m.deployment).toBe('core');
    expect(m.overrides).toEqual([]);
    expect(m.newModules).toEqual([]);
    expect(m.generatedFrom.overlayRoot).toBeNull();
    expect(hasOverrides(m)).toBe(false);
  });

  it('lists every override + new module, sorted, with repo-relative paths', () => {
    const m = manifestFor('overlay-good');
    expect(m.deployment).toBe('acme');
    expect(m.newModules).toEqual(['acme_loyalty']);
    expect(m.overrides.map((o) => `${o.moduleId}:${o.kind}:${o.unitKey}`)).toEqual([
      'price_lists:route:routes.admin.ts',
    ]);
    // No absolute paths leak into the artifact.
    expect(serializeManifestJson(m)).not.toContain(coreSampleRoot);
  });

  it('is byte-identical across repeated builds (SC-003)', () => {
    expect(serializeManifestJson(manifestFor('overlay-good'))).toEqual(
      serializeManifestJson(manifestFor('overlay-good')),
    );
  });
});
