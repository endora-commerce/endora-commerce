import { describe, it, expect } from 'vitest';
import {
  selectedDeployment,
  overlayModulesRootFor,
  activeOverlayModulesRoot,
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
