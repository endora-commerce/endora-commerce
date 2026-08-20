import { describe, it, expect } from 'vitest';
import {
  discoverOverlayModuleManifests,
  loadOverlayModuleEntries,
} from '../../src/overlay/overlay-runtime.js';

/**
 * US2 scenario 2: a deployment that does not ship the module resolves without
 * it and with no dangling references.
 *
 * Both halves of discovery are asserted — the manifests and the composer
 * entries — because since D-104 they are the two runtime discoveries a
 * composition root performs, and a build that found manifests but no entries
 * would compose a module the permission catalogue advertises and no route
 * answers for.
 */
describe('US2 — module absent in a deployment without it (T028)', () => {
  it('discovers no overlay modules for a bare-core build', async () => {
    expect(await discoverOverlayModuleManifests({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(await loadOverlayModuleEntries({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('discovers no overlay modules for a deployment with no overlay dir', async () => {
    const env = { DEPLOYMENT: 'no-such-deployment' } as NodeJS.ProcessEnv;
    expect(await discoverOverlayModuleManifests(env)).toEqual([]);
    expect(await loadOverlayModuleEntries(env)).toEqual([]);
  });
});
