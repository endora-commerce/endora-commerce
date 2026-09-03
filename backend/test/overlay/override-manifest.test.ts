import { describe, it, expect } from 'vitest';
import { resolveOverlay } from '../../src/overlay/resolve-overlay.js';
import {
  buildOverrideManifest,
  serializeManifestJson,
} from '../../src/overlay/override-manifest.js';
import { FIXTURES, overlayRoot } from './_fixtures.js';

// A deterministic repo-relative base for the test, so no absolute path can
// reach the artefact.
const base = FIXTURES;

function manifestFor(overlayName: string | null) {
  const overlayPath = overlayName === null ? null : overlayRoot(overlayName);
  const deployment = overlayName === null ? null : 'acme';
  return buildOverrideManifest({
    deployment,
    overlayRoot: overlayPath,
    resolution: resolveOverlay({ overlayRoot: overlayPath, deployment }),
    base,
  });
}

describe('override-manifest — emit shape & determinism (T010, FR-005/FR-006)', () => {
  it('bare-core manifest names core and reads no overlay root (SC-006)', () => {
    const m = manifestFor(null);
    expect(m.deployment).toBe('core');
    expect(m.newModules).toEqual([]);
    expect(m.generatedFrom.overlayRoot).toBeNull();
  });

  it('records only what a deployment build can know (v2)', () => {
    // `overrides` and `generatedFrom.coreRoot` are gone with file shadowing
    // (feature 103, D-201): the first could only ever be empty, and the second
    // recorded the path of a scan that no longer happens.
    const m = manifestFor('overlay-entries');
    expect(Object.keys(m).sort()).toEqual(['deployment', 'generatedFrom', 'newModules']);
    expect(Object.keys(m.generatedFrom)).toEqual(['overlayRoot']);
  });

  it('lists every module the deployment adds, sorted, with a repo-relative root', () => {
    const m = manifestFor('overlay-entries');
    expect(m.deployment).toBe('acme');
    expect(m.newModules).toEqual(['fixture_composed', 'fixture_manifest_only']);
    expect(m.generatedFrom.overlayRoot).toBe('overlay-entries');
    // No absolute paths leak into the artifact.
    expect(serializeManifestJson(m)).not.toContain(FIXTURES);
  });

  it('is byte-identical across repeated builds (SC-003)', () => {
    expect(serializeManifestJson(manifestFor('overlay-entries'))).toEqual(
      serializeManifestJson(manifestFor('overlay-entries')),
    );
  });
});
