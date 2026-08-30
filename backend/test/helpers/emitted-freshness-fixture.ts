/**
 * A synthetic checkout holding one emitting package, on disk.
 *
 * The red proofs for `scripts/lib/emitted-freshness.ts` have to enter where a
 * real run enters (issue #130): the derivation's inputs are a
 * `pnpm-workspace.yaml`, a `package.json`'s `exports` map, a
 * `tsconfig.build.json` reached through a relative `extends`, and two files'
 * modification times. A proof handed a ready-made `EmittingPackage` would prove
 * the mtime comparison and skip every one of those readings — which is the half
 * that decides *which file* is being compared, and therefore the half a moved
 * layout breaks.
 *
 * It is one builder rather than one per caller, for the reason !1182 found: a
 * check and its companion test that each derive the same population end up with
 * two copies, and the second goes stale invisibly. `check-inventory.test.ts`
 * and `check-action-route-permissions.test.ts` both call this.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  emittingPackages,
  type EmittingPackage,
} from '../../scripts/lib/emitted-freshness.js';

export interface EmittingPackageFixtureOptions {
  /**
   * Whether the source is newer than the artefact — the state an author who
   * edited `src/manifest.ts` and did not rebuild is in.
   */
  readonly sourceIsNewer: boolean;
  /**
   * Whether the source the artefact is emitted from exists at all. `false`
   * stages the artefact this derivation must refuse to judge rather than
   * report current.
   */
  readonly sourceExists?: boolean;
}

export interface EmittingPackageFixture {
  readonly root: string;
  /** The package directory, absolute. */
  readonly packageDir: string;
  /** The location a manifest registry records for a bare specifier (D-149). */
  readonly recordedLocation: string;
  /** What the derivation makes of this checkout — the real reading, not a stub. */
  readonly packages: readonly EmittingPackage[];
  readonly cleanup: () => void;
}

const PACKAGE_NAME = '@endora-commerce/mod-fixture';

/** One workspace member that emits, with the two mtimes set as asked. */
export function createEmittingPackageFixture(
  options: EmittingPackageFixtureOptions,
): EmittingPackageFixture {
  const root = mkdtempSync(join(tmpdir(), 'emitting-package-'));
  const packageDir = join(root, 'packages', 'modules', 'fixture');
  mkdirSync(join(packageDir, 'src'), { recursive: true });
  mkdirSync(join(packageDir, 'dist'), { recursive: true });

  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/modules/*\n', 'utf8');
  writeFileSync(
    join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: PACKAGE_NAME,
        version: '0.0.0',
        private: true,
        type: 'module',
        endora: { type: 'module', id: 'fixture' },
        exports: {
          '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' },
          './package.json': './package.json',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  // Two configs, and the emit layout is split across them exactly as every
  // package in this repository splits it: `outDir` in the base, `rootDir` in
  // the build file. A reader of one alone finds half an answer.
  writeFileSync(
    join(packageDir, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { outDir: './dist' } }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(packageDir, 'tsconfig.build.json'),
    `${JSON.stringify(
      { extends: './tsconfig.json', compilerOptions: { rootDir: './src' } },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const source = join(packageDir, 'src', 'manifest.ts');
  const artefact = join(packageDir, 'dist', 'manifest.js');
  writeFileSync(artefact, 'export const manifest = { id: "fixture" };\n', 'utf8');
  if (options.sourceExists !== false) {
    writeFileSync(source, 'export const manifest = { id: "fixture" };\n', 'utf8');
    // Absolute seconds rather than "now", so the two are ordered by more than a
    // filesystem's timestamp granularity.
    const emittedAt = 1_700_000_000;
    const editedAt = options.sourceIsNewer ? emittedAt + 60 : emittedAt - 60;
    utimesSync(artefact, emittedAt, emittedAt);
    utimesSync(source, editedAt, editedAt);
  }

  return {
    root,
    packageDir,
    recordedLocation: join(packageDir, 'package.json'),
    packages: emittingPackages(root),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
