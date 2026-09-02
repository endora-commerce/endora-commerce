import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkEmittedFreshness,
  emittingPackages,
  freshnessRefusal,
  originOf,
  packageHolding,
  readArtefactOf,
  rootExportOf,
  sourceOfEmitted,
  nodeFreshnessFs,
} from '../src/lib/emitted-freshness.js';

/**
 * `emitted-freshness` reads a checkout, so every fixture here is one.
 *
 * The derivation's inputs are `pnpm-workspace.yaml`, a `package.json`'s
 * `exports` map, a `tsconfig.build.json` reached through a relative `extends`,
 * and two modification times. A test that constructed an `EmittingPackage` by
 * hand would prove the mtime comparison and leave every one of those readings
 * unproven — and those are the half a layout change breaks.
 */

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface CheckoutOptions {
  /** Where the build configuration puts `rootDir`, if anywhere. */
  readonly rootDir?: string | null;
  readonly outDir?: string;
  readonly exports?: Readonly<Record<string, unknown>> | null;
  /** Seconds; the source is written at `emittedAt + sourceOffset`. */
  readonly sourceOffset?: number;
  readonly writeSource?: boolean;
  readonly writeArtefact?: boolean;
}

const EMITTED_AT = 1_700_000_000;

/** One workspace member with a build configuration split across two files. */
function checkout(options: CheckoutOptions = {}): {
  readonly root: string;
  readonly dir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'emitted-freshness-'));
  roots.push(root);
  const dir = join(root, 'packages', 'modules', 'thing');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/modules/*\n', 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@scope/thing',
      exports:
        options.exports === undefined
          ? { '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' } }
          : (options.exports ?? undefined),
    }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    // The base holds `outDir`, exactly as !891's split does; a reader that
    // stopped at `tsconfig.build.json` would find half the layout.
    JSON.stringify({ compilerOptions: { outDir: `./${options.outDir ?? 'dist'}` } }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'tsconfig.build.json'),
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions:
        options.rootDir === null ? {} : { rootDir: `./${options.rootDir ?? 'src'}` },
    }),
    'utf8',
  );
  if (options.writeArtefact !== false) {
    writeFileSync(join(dir, 'dist', 'manifest.js'), 'export const manifest = {};\n', 'utf8');
    utimesSync(join(dir, 'dist', 'manifest.js'), EMITTED_AT, EMITTED_AT);
  }
  if (options.writeSource !== false) {
    writeFileSync(join(dir, 'src', 'manifest.ts'), 'export const manifest = {};\n', 'utf8');
    const at = EMITTED_AT + (options.sourceOffset ?? -60);
    utimesSync(join(dir, 'src', 'manifest.ts'), at, at);
  }
  return { root, dir };
}

describe('emittingPackages — which members emit, read from their own declarations', () => {
  it('reads the emit layout across a relative `extends`', () => {
    const { root, dir } = checkout();
    const [pkg] = emittingPackages(root);
    expect(pkg?.name).toBe('@scope/thing');
    expect(pkg?.dir).toBe(dir);
    expect(pkg?.emit).toEqual({ rootDir: 'src', outDir: 'dist' });
    expect(rootExportOf(pkg!)).toBe(join(dir, 'dist', 'manifest.js'));
  });

  it('leaves out a member with no build configuration — it publishes its sources', () => {
    const { root, dir } = checkout();
    rmSync(join(dir, 'tsconfig.build.json'));
    expect(emittingPackages(root)).toEqual([]);
  });

  it('refuses a build configuration that declares only half a layout', () => {
    const { root } = checkout({ rootDir: null });
    expect(() => emittingPackages(root)).toThrow(/`rootDir`/);
  });
});

describe('which file a run really read', () => {
  it('follows a recorded `package.json` to the package root export', () => {
    // The bare-specifier shape: a manifest registry records the package.json as
    // the module's location, and the bytes it read are the root export target.
    const { root, dir } = checkout();
    const packages = emittingPackages(root);
    expect(readArtefactOf(join(dir, 'package.json'), packages)).toBe(
      join(dir, 'dist', 'manifest.js'),
    );
  });

  it('leaves a `package.json` alone when the package declares no root export', () => {
    const { root, dir } = checkout({ exports: { './backend': './dist/backend/index.js' } });
    const packages = emittingPackages(root);
    expect(readArtefactOf(join(dir, 'package.json'), packages)).toBe(join(dir, 'package.json'));
  });

  it('names itself for every other path', () => {
    const { root, dir } = checkout();
    const named = join(dir, 'src', 'manifest.ts');
    expect(readArtefactOf(named, emittingPackages(root))).toBe(named);
  });

  it('classifies a path as emitted, source or outside every package', () => {
    const { root, dir } = checkout();
    const [pkg] = emittingPackages(root);
    expect(originOf(join(dir, 'dist', 'manifest.js'), pkg!)).toBe('emitted');
    expect(originOf(join(dir, 'src', 'manifest.ts'), pkg!)).toBe('source');
    expect(originOf(join(root, 'elsewhere.ts'), null)).toBe('outside');
    expect(packageHolding(join(root, 'elsewhere.ts'), emittingPackages(root))).toBeNull();
  });

  it('inverts an emitted path to the source that exists, not to a guess', () => {
    const { root, dir } = checkout();
    const [pkg] = emittingPackages(root);
    const fs = nodeFreshnessFs();
    expect(sourceOfEmitted(pkg!, join(dir, 'dist', 'manifest.js'), fs)).toBe(
      join(dir, 'src', 'manifest.ts'),
    );
    // `.js` has two possible sources; the one on disk wins, and a stem with
    // neither answers `null` rather than naming a file that is not there.
    expect(sourceOfEmitted(pkg!, join(dir, 'dist', 'absent.js'), fs)).toBeNull();
  });
});

describe('the verdict', () => {
  const findingsFor = (options: CheckoutOptions): ReturnType<typeof checkEmittedFreshness> => {
    const { root, dir } = checkout(options);
    return checkEmittedFreshness({
      read: [join(dir, 'package.json')],
      packages: emittingPackages(root),
    });
  };

  it('reports an artefact its source has outrun', () => {
    const result = findingsFor({ sourceOffset: +60 });
    expect(result.findings.map((f) => f.kind)).toEqual(['stale-artefact']);
    expect(result.emitted).toHaveLength(1);
    expect(result.compared).toHaveLength(1);
    expect(freshnessRefusal('[x]', result)).toContain('build:packages');
  });

  it('says nothing about an artefact emitted after its source', () => {
    const result = findingsFor({ sourceOffset: -60 });
    expect(result.findings).toEqual([]);
    expect(result.compared).toHaveLength(1);
    expect(freshnessRefusal('[x]', result)).toBeNull();
  });

  it('says nothing when the two share a timestamp — the build wrote them together', () => {
    expect(findingsFor({ sourceOffset: 0 }).findings).toEqual([]);
  });

  it('refuses an artefact no source under `rootDir` emits, rather than passing it', () => {
    const result = findingsFor({ writeSource: false });
    expect(result.findings.map((f) => f.kind)).toEqual(['unpairable-artefact']);
    expect(result.compared).toEqual([]);
  });

  it('refuses an artefact that is not on disk at all', () => {
    const result = findingsFor({ writeArtefact: false });
    expect(result.findings.map((f) => f.kind)).toEqual(['unpairable-artefact']);
  });

  it('has no opinion on a manifest read out of a package source', () => {
    const { root, dir } = checkout({ sourceOffset: +60 });
    const result = checkEmittedFreshness({
      read: [join(dir, 'src', 'manifest.ts')],
      packages: emittingPackages(root),
    });
    expect(result.findings).toEqual([]);
    expect(result.emitted).toEqual([]);
  });

  it('has no opinion on a path outside every emitting package', () => {
    const { root } = checkout({ sourceOffset: +60 });
    const result = checkEmittedFreshness({
      read: [join(root, 'backend', 'src', 'x.ts')],
      packages: emittingPackages(root),
    });
    expect(result.findings).toEqual([]);
    expect(result.emitted).toEqual([]);
  });
});
