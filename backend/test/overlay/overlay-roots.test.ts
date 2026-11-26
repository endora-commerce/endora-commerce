import { describe, it, expect } from 'vitest';
import {
  selectedDeployment,
  overlayModulesRootFor,
  activeOverlayModulesRoot,
  deploymentsOnDisk,
} from '../../src/overlay/overlay-roots.js';

describe('overlay-roots — deployment selection (T005)', () => {
  it('returns null when DEPLOYMENT is unset (bare core)', () => {
    expect(selectedDeployment({})).toBeNull();
  });

  it('treats blank/whitespace DEPLOYMENT as unset', () => {
    expect(selectedDeployment({ DEPLOYMENT: '   ' })).toBeNull();
  });

  it('returns the trimmed deployment name when set', () => {
    expect(selectedDeployment({ DEPLOYMENT: '  acme ' })).toBe('acme');
  });

  it('resolves the overlay root path under backend/src/apps/<deployment>/modules', () => {
    const root = overlayModulesRootFor('acme');
    expect(root.replace(/\\/g, '/')).toMatch(/backend\/src\/apps\/acme\/modules$/);
  });

  it('resolves to null when the deployment ships no overlay directory', () => {
    // A deployment name that does not exist on disk → core-only, not an error.
    expect(activeOverlayModulesRoot({ DEPLOYMENT: 'no-such-deployment-xyz' })).toBeNull();
  });

  it('resolves to null with no DEPLOYMENT set', () => {
    expect(activeOverlayModulesRoot({})).toBeNull();
  });
});

describe('overlay-roots — the deployments shipped in this checkout (#120)', () => {
  /**
   * The determinism gate reads this to decide which committed override
   * manifests to compare, so it must not depend on `DEPLOYMENT`: the whole
   * point is that one run covers every deployment's artefact rather than the
   * one the environment happens to select.
   */
  it('lists the reference deployment, sorted and env-independent', () => {
    const before = process.env['DEPLOYMENT'];
    try {
      delete process.env['DEPLOYMENT'];
      const bare = deploymentsOnDisk();
      process.env['DEPLOYMENT'] = 'no-such-deployment-xyz';
      expect(deploymentsOnDisk()).toEqual(bare);
      expect(bare).toContain('example');
      expect([...bare]).toEqual([...bare].sort());
    } finally {
      if (before === undefined) delete process.env['DEPLOYMENT'];
      else process.env['DEPLOYMENT'] = before;
    }
  });
});

/**
 * `specs/190-overlay-full-modules/` T019 (FR-016): the compiled backend (`backend/dist`) hands
 * `backend/src` as the source root the freshness guard judges it against, when that directory
 * exists; run from sources (`tsx`, `backend/src`) the source root is the deployment root.
 */
describe('overlay-roots — the source root (T019)', () => {
  it('is the deployment root itself when run from sources', async () => {
    const { deploymentRoot, deploymentSourceRoot } = await import('../../src/overlay/overlay-roots.js');
    expect(deploymentSourceRoot()).toBe(deploymentRoot());
  });

  it('is backend/src beside a compiled backend/dist, when it exists', async () => {
    const { sourceRootFor } = await import('../../src/overlay/overlay-roots.js');
    const { mkdtempSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const backend = mkdtempSync(join(tmpdir(), 'backend-'));
    mkdirSync(join(backend, 'dist'));
    expect(sourceRootFor(join(backend, 'dist'))).toBeUndefined();
    mkdirSync(join(backend, 'src'));
    expect(sourceRootFor(join(backend, 'dist'))).toBe(join(backend, 'src'));
    expect(sourceRootFor(join(backend, 'src'))).toBe(join(backend, 'src'));
  });
});
