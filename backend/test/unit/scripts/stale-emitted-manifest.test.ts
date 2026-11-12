import { existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createSplitModuleTreeFixture,
  packagedModuleIds,
  type MovedModuleTreeFixture,
} from '../../helpers/moved-module-tree-fixture.js';

/**
 * A check that reads a stale emitted manifest refuses, whichever check it is
 * (issue #104).
 *
 * A module package resolves through its `exports` map at `./dist` (D-164), and
 * the module layout every check resolves is read out of the generated index,
 * which imports each package's **emitted** manifest. So an author who edits a
 * package's `src/manifest.ts` and runs a check without rebuilding is answered
 * about the previous build. `emitted-freshness.ts` is the refusal, and until
 * this file six checks called it while every other one went through
 * `requireModuleLayout` without it.
 *
 * The refusal therefore sits in `requireModuleLayout`, the one loader the
 * estate shares, and the proofs here are checks that were **not** individually
 * wired — over a fixture tree whose packages carry this checkout's real build,
 * with one package's manifest source made newer than its emitted file. That is
 * exactly the state an author leaves behind, entered at the top: a file's
 * timestamp on disk, not a pre-classified finding.
 */

/** Where the fixture stages a module package — its own concrete layout. */
const packagedModulePath = (id: string): string => join('packages', 'modules', id);

const UNWIRED_CHECKS = [
  'check-off-state-coverage.ts',
  'check-singleton-identity.ts',
  'check-admin-zones.ts',
  'check-module-boundary.ts',
] as const;

describe('a stale emitted manifest is refused by a check that was never wired to it (issue #104)', () => {
  let fixture: MovedModuleTreeFixture;
  let staleModule: string;

  beforeAll(() => {
    fixture = createSplitModuleTreeFixture({ packaged: [] });
    const packaged = packagedModuleIds();
    expect(packaged.length, 'this checkout holds no module package to make stale').toBeGreaterThan(0);
    staleModule = [...packaged].sort()[0]!;
    // The source is touched a minute into the future: strictly newer than any
    // emitted file the build wrote, which is the comparison's own predicate.
    const source = join(fixture.root, packagedModulePath(staleModule), 'src', 'manifest.ts');
    expect(existsSync(source), `the fixture staged no ${source}`).toBe(true);
    const later = new Date(Date.now() + 60_000);
    utimesSync(source, later, later);
  }, 300_000);

  afterAll(() => {
    fixture?.cleanup();
  });

  for (const script of UNWIRED_CHECKS) {
    it(`${script} exits 2 and names the stale package`, () => {
      const result = fixture.run(script);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('[stale-artefact]');
      expect(result.output).toContain(`${packagedModulePath(staleModule)}/src/manifest.ts`);
    }, 120_000);
  }
});
