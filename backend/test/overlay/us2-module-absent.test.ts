import { describe, it, expect } from 'vitest';
import {
  discoverOverlayModuleManifests,
  loadOverlayModulePlugins,
  type OverlayModuleContext,
} from '../../src/overlay/overlay-runtime.js';

const stubCtx = {} as unknown as OverlayModuleContext;

// US2 scenario 2: a deployment that does not ship the module resolves without it
// and with no dangling references.
describe('US2 — module absent in a deployment without it (T028)', () => {
  it('discovers no overlay modules for a bare-core build', async () => {
    expect(await discoverOverlayModuleManifests({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(await loadOverlayModulePlugins(stubCtx, {} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('discovers no overlay modules for a deployment with no overlay dir', async () => {
    const env = { DEPLOYMENT: 'no-such-deployment' } as NodeJS.ProcessEnv;
    expect(await discoverOverlayModuleManifests(env)).toEqual([]);
    expect(await loadOverlayModulePlugins(stubCtx, env)).toEqual([]);
  });
});
