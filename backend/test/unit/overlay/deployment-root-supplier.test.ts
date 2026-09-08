import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeOverlayModulesRoot,
  deploymentsOnDisk,
  overlayModulesRootFor,
  selectedDeployment,
} from '@endora-commerce/platform/overlay';
import { loadDivergenceDeclaration } from '../../../src/overlay/divergence-loader.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { FIXTURES } from '../../overlay/_fixtures.js';

/**
 * The deployment root is **supplied**, and the declaration's extension is
 * **probed** (`specs/110-instance-repository/contracts/application-root-supplier.md`
 * §1 and §3).
 *
 * Two claims, and each has a failing shape that is silent:
 *
 *  - a platform function that derived its own root would answer about
 *    `packages/platform/{src,dist}` whatever root it was handed, and every
 *    deployment would read as absent — the D115-3 failure one directory over;
 *  - `RUNNING_FROM_DIST` (`import.meta.url.includes('/dist/')`) is **true**
 *    inside `packages/platform/dist/overlay/` under `tsx` as well as under
 *    `node`, so a loader keeping it would compose `divergence.js` for a source
 *    tree and read every declaration as empty. An absent declaration and an
 *    empty one are deliberately the same answer, so nothing would say so.
 *
 * The fixtures are two deployment roots that exist on disk in one spelling
 * each — one `.js`, one `.ts` — which is what makes a flag and a probe give
 * different answers in the same process (issue #130).
 */

const COMPILED_ROOT = join(FIXTURES, 'deployment-compiled');
const SOURCE_ROOT = join(FIXTURES, 'deployment-source');
const MALFORMED_ROOT = join(FIXTURES, 'deployment-malformed');

describe('the platform answers about the root it is given', () => {
  it('composes a deployment overlay path under the supplied root', () => {
    expect(overlayModulesRootFor(COMPILED_ROOT, 'acme')).toBe(
      join(COMPILED_ROOT, 'apps', 'acme', 'modules'),
    );
  });

  it('lists the deployments under the supplied root, and no others', () => {
    expect(deploymentsOnDisk(COMPILED_ROOT)).toEqual(['fixture_compiled_deployment']);
    expect(deploymentsOnDisk(SOURCE_ROOT)).toEqual(['fixture_source_deployment']);
  });

  it('answers nothing for a root that has no apps/ at all', () => {
    expect(deploymentsOnDisk(join(COMPILED_ROOT, 'no_such_root'))).toEqual([]);
    expect(
      activeOverlayModulesRoot(join(COMPILED_ROOT, 'no_such_root'), {
        DEPLOYMENT: 'fixture_compiled_deployment',
      }),
    ).toBeNull();
  });

  it('reads the deployment name from the environment and no path at all', () => {
    expect(selectedDeployment({})).toBeNull();
    expect(selectedDeployment({ DEPLOYMENT: '  acme ' })).toBe('acme');
  });
});

describe('the divergence declaration is resolved, not spelled', () => {
  it('reads a declaration committed as divergence.js', async () => {
    const declared = await loadDivergenceDeclaration(
      { DEPLOYMENT: 'fixture_compiled_deployment' },
      COMPILED_ROOT,
    );
    expect(Object.keys(declared.reasons)).toEqual(['compiled-fixture']);
  });

  it('reads a declaration committed as divergence.ts', async () => {
    const declared = await loadDivergenceDeclaration(
      { DEPLOYMENT: 'fixture_source_deployment' },
      SOURCE_ROOT,
    );
    expect(Object.keys(declared.reasons)).toEqual(['source-fixture']);
  });

  it('still answers "declares nothing" for a deployment with no file in either spelling', async () => {
    const declared = await loadDivergenceDeclaration(
      { DEPLOYMENT: 'fixture_source_deployment' },
      COMPILED_ROOT,
    );
    expect(declared).toEqual({ omittedModules: [], decorationOrder: {}, reasons: {} });
  });

  it('refuses a malformed declaration by naming the file it read, under the supplied root', async () => {
    // R3.6 — the sentence a reader acts on names a path in *their* tree. What
    // this used to name was the literal `backend/src/apps/<d>/divergence.ts`,
    // which its own doc block already called a package asserting a layout it
    // cannot see; it is now the file the loader actually opened, so it also
    // carries the spelling that is really on disk.
    await expect(
      loadDivergenceDeclaration({ DEPLOYMENT: 'fixture_malformed_deployment' }, MALFORMED_ROOT),
    ).rejects.toThrow(
      join(MALFORMED_ROOT, 'apps', 'fixture_malformed_deployment', 'divergence.js'),
    );
  });

  it('defaults to the application’s one derivation, which is this checkout', async () => {
    const declared = await loadDivergenceDeclaration({ DEPLOYMENT: 'example' });
    const supplied = await loadDivergenceDeclaration({ DEPLOYMENT: 'example' }, deploymentRoot());
    expect(declared).toEqual(supplied);
    expect(Object.keys(declared.reasons).length).toBeGreaterThan(0);
  });
});
