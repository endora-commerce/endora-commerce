/**
 * `contracts/package-scope-layout.md` §7's red proofs.
 *
 * Each enters at a **fixture package tree on disk**: the layout derivation, the
 * walk, the analysis and the reduction all run. A proof that handed in a
 * resolved layout would prove the hosts and leave the derivation the whole
 * contract is about unproven — and the derivation is the only thing that
 * differs between the two hosts (§2: *"the substitution is one seam, not
 * thirty-four adapters"*).
 *
 * Proof 6 — *a missing host makes every host-dependent rule `unreadable`* — has
 * no subject in this build and is **not** asserted here rather than being
 * asserted vacuously: none of Phase 1's five rules resolves anything out of
 * `@endora-commerce/platform`. It lands with the first rule that does, in
 * Phase 2.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { analyzeSource as containerAnalyse } from '../src/rules/container-imports.js';
import { resolvePackageLayout, runCheck } from '../src/check/index.js';

import { createPackageFixture, touchIntoTheFuture, type PackageFixture } from './check-fixture.js';

const fixtures: PackageFixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
});

function fixture(...args: Parameters<typeof createPackageFixture>): string {
  const created = createPackageFixture(...args);
  fixtures.push(created);
  return created.dir;
}

const OFFENDING = "import { asClass } from 'awilix';\nexport const x = asClass;\n";

describe('proof 1 — the layout is the only seam', () => {
  it('one analysis, two attributions, the same finding', () => {
    const dir = fixture({
      moduleId: 'acme_loyalty',
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: OFFENDING },
      ],
    });

    // Package scope: the host attributes by the declared `endora.id`.
    const packageScope = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    // Repository scope: the identical analysis, over the identical text, with
    // the application tree's own attribution — a `/src/modules/<id>/` path.
    const repositoryScope = containerAnalyse(
      OFFENDING,
      '/repo/backend/src/modules/acme_loyalty/backend/index.ts',
    );

    expect(packageScope.report.results[0]!.findings).toHaveLength(1);
    expect(repositoryScope).toHaveLength(1);
    expect(repositoryScope[0]!.moduleId).toBe('acme_loyalty');
    expect(repositoryScope[0]!.specifier).toBe('awilix');
  });
});

describe('proof 2 — short walk', () => {
  it('a declared subpath with an empty source directory exits 2 from the floor', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './migrations': './dist/migrations/index.js',
      },
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/migrations/index.ts', content: 'export const migrations = [];\n' },
      ],
    });
    rmSync(join(dir, 'src', 'migrations'), { recursive: true });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });

    // From the floor, not from the rule: the rule found nothing.
    expect(run.report.results[0]!.verdict).toBe('unreadable');
    expect(run.report.results[0]!.findings).toEqual([]);
    expect(run.report.exitCode).toBe(2);
  });

  it('the declaration is what makes it short — the layer survives its source going', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './migrations': './dist/migrations/index.js',
      },
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/migrations/index.ts', content: 'export const migrations = [];\n' },
      ],
    });
    rmSync(join(dir, 'src', 'migrations'), { recursive: true });

    const layout = resolvePackageLayout(dir);
    expect(layout.layers.map((layer) => layer.subpath).sort()).toEqual([
      '.',
      './backend',
      './migrations',
    ]);
  });
});

describe('proof 3 — omitted expectation', () => {
  it('the same fixture with the subpath removed exits 0 and prints no token for it', () => {
    const dir = fixture({
      exports: { '.': './dist/manifest.js', './backend': './dist/backend/index.js' },
    });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    const coverage = run.report.results[0]!.readSize?.coverage ?? [];

    expect(run.report.exitCode).toBe(0);
    expect(coverage).toEqual([{ source: 'package-exports', expected: 2, covered: 2 }]);
    // `./package.json` is a declared subpath the build writes nothing for, so it
    // is not a layer and contributes no expectation.
    expect(coverage.some((entry) => entry.expected === 3)).toBe(false);
  });
});

describe('proof 4 — attribution by endora.id', () => {
  it('a package at a directory not named after its id is attributed correctly', () => {
    const dir = fixture({
      moduleId: 'acme_loyalty',
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: OFFENDING },
      ],
    });
    // The directory is a mkdtemp name and has never resembled the module id;
    // rename it once more so the point cannot be read as accidental.
    const renamed = `${dir}-not-the-id`;
    renameSync(dir, renamed);
    fixtures[fixtures.length - 1] = {
      dir: renamed,
      cleanup: () => rmSync(renamed, { recursive: true, force: true }),
    };

    const layout = resolvePackageLayout(renamed);
    expect(layout.moduleId).toBe('acme_loyalty');
    expect(layout.moduleIds).toEqual(['acme_loyalty']);

    const run = runCheck({ cwd: renamed, rules: ['check:container-imports'] });
    expect(run.report.results[0]!.findings).toHaveLength(1);
  });
});

describe('proof 5 — stale artefact', () => {
  it('a source newer than its emitted manifest is unreadable, not answered from source', () => {
    const dir = fixture({
      files: [
        {
          path: 'src/manifest.ts',
          content: "export const manifest = { i18n: { bundlesDir: 'i18n' } };\n",
        },
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
      ],
      emitted: [
        // The artefact carries no `bundlesDir`: the source has moved on. If the
        // run answered from source it would report `not-applicable` from a
        // declaration the platform cannot see — which is the one thing a
        // conformance command must not do.
        { path: 'dist/manifest.js', content: 'export const manifest = {};\n' },
        { path: 'dist/backend/index.js', content: 'export function registerModule() {}\n' },
      ],
    });
    touchIntoTheFuture(join(dir, 'src', 'manifest.ts'));

    const run = runCheck({ cwd: dir, rules: ['check:bundle-pairing'] });

    expect(run.report.results[0]!.verdict).toBe('unreadable');
    expect(run.report.results[0]!.explanation).toContain('Build the package');
    expect(run.report.exitCode).toBe(2);
  });

  it('a package that has never been built is unreadable, naming the build', () => {
    const dir = fixture();
    rmSync(join(dir, 'dist'), { recursive: true });

    const run = runCheck({ cwd: dir, rules: ['check:bundle-pairing'] });

    expect(run.report.results[0]!.verdict).toBe('unreadable');
    expect(run.report.exitCode).toBe(2);
  });
});

describe('a module package with no build configuration', () => {
  it('is unreadable rather than not-applicable — the two are not the same claim', () => {
    const dir = fixture({ noBuildConfig: true });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });

    expect(run.report.results[0]!.verdict).toBe('unreadable');
    expect(run.report.results[0]!.explanation).toContain('tsconfig.build.json');
    expect(run.report.exitCode).toBe(2);
  });
});

describe('the emitted manifest is what a manifest-reading rule reads', () => {
  it('the platform composes a package through its artefact, so the rule does too', () => {
    const dir = fixture({
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
      ],
      emitted: [
        {
          path: 'dist/manifest.js',
          content: "export const manifest = { i18n: { bundlesDir: 'i18n' } };\n",
        },
        { path: 'dist/backend/index.js', content: 'export function registerModule() {}\n' },
      ],
    });
    mkdirSync(join(dir, 'i18n'), { recursive: true });
    for (const language of ['en', 'pl']) {
      writeFileSync(join(dir, 'i18n', `${language}.json`), '{"a.b": "A"}\n');
    }

    const run = runCheck({ cwd: dir, rules: ['check:bundle-pairing'] });
    const result = run.report.results[0]!;

    // The artefact declares a bundles directory the source does not, so the rule
    // ran rather than reporting `not-applicable`.
    expect(result.verdict).toBe('ran');
  });
});
