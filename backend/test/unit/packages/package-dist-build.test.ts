/**
 * The packages under `packages/` ship a built `dist` (feature 080, T042).
 *
 * Until this landed, all five set `"main": "./src/index.ts"` and had no `tsc` build at
 * all: `outDir` was configured in every one of them and had never been executed, which is
 * how a `rootDir` defect sat latent in three of five. The four properties asserted here
 * are the ones whose absence is invisible:
 *
 * 1. **The manifest points at `dist`, with a `types` condition on every subpath.** An
 *    `exports` entry without one makes a `moduleResolution: Bundler` consumer fall back
 *    to `main` — it resolves, it type-checks, and it is reading a different file from the
 *    one it executes.
 * 2. **Only the configuration with `paths` cleared may emit.** `rootDir` plus an active
 *    `paths` block is the TS6059 trap: `tsc` exits 2 *and emits the sibling package's
 *    output beside that sibling's source*. `dist/` is git-ignored, so the same accident
 *    landing where it was configured to land would leave no trace at all.
 * 3. **Every bare specifier a published source imports is a declared runtime
 *    dependency.** A devDependency is not one: it is not installed for a consumer. This
 *    found five in `@b2b/cms-components` — four Tiptap extensions and `leaflet`.
 * 4. **The built declarations are real types.** An unresolvable import inside an emitted
 *    `.d.ts` turns every type flowing through it into `any` with no diagnostic, because
 *    `skipLibCheck: true` (`tsconfig.base.json`) suppresses the error in a dependency's
 *    declarations. Properties 1–3 pass just as happily against an all-`any` build; the
 *    last test in this file is the only thing here that does not.
 *
 * The manifest analysis takes a manifest **object**, so each red proof enters above the
 * predicate rather than being handed a finding somebody already computed.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { findCheckoutRoot } from '../../../../scripts/workspace-resolution.js';

const ROOT = findCheckoutRoot(dirname(fileURLToPath(import.meta.url)));

interface PackageManifest {
  readonly name?: string;
  readonly main?: string;
  readonly types?: string;
  readonly files?: readonly string[];
  readonly scripts?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

interface WorkspacePackage {
  readonly dir: string;
  readonly manifest: PackageManifest;
}

type FindingKind =
  | 'main-outside-dist'
  | 'types-outside-dist'
  | 'export-target-outside-dist'
  | 'export-without-types-condition'
  | 'files-missing-dist'
  | 'no-build-script';

interface Finding {
  readonly kind: FindingKind;
  readonly detail: string;
}

const inDist = (target: string): boolean => target.startsWith('./dist/');

/**
 * Everything wrong with one manifest's distribution shape. Pure — the input is the
 * parsed manifest, which is what lets a fixture drive each finding.
 */
export function distShapeFindings(manifest: PackageManifest): Finding[] {
  const findings: Finding[] = [];

  if (manifest.main === undefined || !inDist(manifest.main)) {
    findings.push({ kind: 'main-outside-dist', detail: manifest.main ?? '<absent>' });
  }
  if (manifest.types === undefined || !inDist(manifest.types)) {
    findings.push({ kind: 'types-outside-dist', detail: manifest.types ?? '<absent>' });
  }
  if (!(manifest.files ?? []).includes('dist')) {
    findings.push({ kind: 'files-missing-dist', detail: JSON.stringify(manifest.files ?? null) });
  }
  if (manifest.scripts?.['build'] === undefined) {
    findings.push({ kind: 'no-build-script', detail: '<absent>' });
  }

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === 'string') {
      if (!inDist(target)) {
        findings.push({ kind: 'export-target-outside-dist', detail: `${subpath} -> ${target}` });
      }
      // A bare string target is legal only where there is nothing to declare — the
      // compiled stylesheet is the one such subpath in this repository.
      if (target.endsWith('.js')) {
        findings.push({ kind: 'export-without-types-condition', detail: subpath });
      }
      continue;
    }
    const conditions = target as Record<string, unknown>;
    if (typeof conditions['types'] !== 'string') {
      findings.push({ kind: 'export-without-types-condition', detail: subpath });
    }
    for (const [condition, value] of Object.entries(conditions)) {
      if (typeof value === 'string' && !inDist(value)) {
        findings.push({
          kind: 'export-target-outside-dist',
          detail: `${subpath} [${condition}] -> ${value}`,
        });
      }
    }
  }

  return findings;
}

/** The packages, derived from the workspace directory rather than written down. */
function workspacePackages(root: string): WorkspacePackage[] {
  const packagesDir = join(root, 'packages');
  const found: WorkspacePackage[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest;
    } catch {
      continue;
    }
    found.push({ dir, manifest });
  }
  return found;
}

/**
 * The tsconfigs in this repository carry `//` comments, which is why this is not a bare
 * `JSON.parse`. Line comments only — no block comment is written in one.
 */
function readJsonc<T>(path: string): T {
  const stripped = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
  return JSON.parse(stripped) as T;
}

const PACKAGES = ROOT === null ? [] : workspacePackages(ROOT);

describe('package distribution shape', () => {
  it('is a checkout of this repository, with packages in it', () => {
    expect(ROOT).not.toBeNull();
    expect(PACKAGES.length).toBeGreaterThan(0);
  });

  describe('distShapeFindings refuses each defect it names', () => {
    const sound: PackageManifest = {
      name: '@b2b/example',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      files: ['dist'],
      scripts: { build: 'tsc -p tsconfig.build.json' },
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    };

    it('passes a sound manifest', () => {
      expect(distShapeFindings(sound)).toEqual([]);
    });

    it('refuses a source `main`', () => {
      expect(distShapeFindings({ ...sound, main: './src/index.ts' }).map((f) => f.kind)).toEqual([
        'main-outside-dist',
      ]);
    });

    it('refuses a source `types`', () => {
      expect(distShapeFindings({ ...sound, types: './src/index.ts' }).map((f) => f.kind)).toEqual([
        'types-outside-dist',
      ]);
    });

    it('refuses an `exports` subpath that still points at source', () => {
      const findings = distShapeFindings({
        ...sound,
        exports: { './*': { types: './src/*.ts', default: './src/*.ts' } },
      });
      expect(findings.map((f) => f.kind)).toEqual([
        'export-target-outside-dist',
        'export-target-outside-dist',
      ]);
    });

    it('refuses a JavaScript `exports` target with no `types` condition', () => {
      // The failure that looks like success: node resolves `dist`, `tsc` falls back to
      // `main`, and nothing compares the two answers.
      expect(
        distShapeFindings({ ...sound, exports: { '.': './dist/index.js' } }).map((f) => f.kind),
      ).toEqual(['export-without-types-condition']);
    });

    it('accepts a non-JavaScript `exports` target with no `types` condition', () => {
      expect(
        distShapeFindings({ ...sound, exports: { './styles.css': './dist/example.css' } }),
      ).toEqual([]);
    });

    it('refuses a missing `files` entry', () => {
      expect(distShapeFindings({ ...sound, files: ['src'] }).map((f) => f.kind)).toEqual([
        'files-missing-dist',
      ]);
    });

    it('refuses a package with no `build` script', () => {
      expect(distShapeFindings({ ...sound, scripts: { typecheck: 'tsc' } }).map((f) => f.kind)).toEqual(
        ['no-build-script'],
      );
    });
  });

  it('every workspace package ships dist and nothing else', () => {
    const offenders = PACKAGES.map(({ manifest }) => ({
      name: manifest.name,
      findings: distShapeFindings(manifest),
    })).filter((entry) => entry.findings.length > 0);

    expect(offenders).toEqual([]);
  });
});

describe('only the emit configuration may reach another package', () => {
  interface TsConfig {
    readonly compilerOptions?: Record<string, unknown>;
    readonly exclude?: readonly string[];
  }

  it('type-check configs cannot emit, and emit configs clear `paths`', () => {
    const defects: string[] = [];

    for (const { dir, manifest } of PACKAGES) {
      const typecheck = readJsonc<TsConfig>(join(dir, 'tsconfig.json'));
      const build = readJsonc<TsConfig>(join(dir, 'tsconfig.build.json'));

      if (typecheck.compilerOptions?.['noEmit'] !== true) {
        defects.push(`${manifest.name}: tsconfig.json must set noEmit — \`paths\` is active there`);
      }
      if (JSON.stringify(build.compilerOptions?.['paths']) !== '{}') {
        defects.push(`${manifest.name}: tsconfig.build.json must clear \`paths\``);
      }
      if (build.compilerOptions?.['rootDir'] !== './src') {
        defects.push(`${manifest.name}: tsconfig.build.json must set rootDir to ./src`);
      }
      if (build.compilerOptions?.['noEmit'] !== false) {
        defects.push(`${manifest.name}: tsconfig.build.json must re-enable emit`);
      }
      if (build.compilerOptions?.['noEmitOnError'] !== true) {
        defects.push(`${manifest.name}: tsconfig.build.json must set noEmitOnError`);
      }
      if (!(build.exclude ?? []).includes('**/*.test.ts')) {
        defects.push(`${manifest.name}: tsconfig.build.json must exclude test files from dist`);
      }
      if (manifest.scripts?.['build']?.includes('tsconfig.build.json') !== true) {
        defects.push(`${manifest.name}: the build script must use tsconfig.build.json`);
      }
    }

    expect(PACKAGES.length).toBeGreaterThan(0);
    expect(defects).toEqual([]);
  });
});

describe('published sources declare every dependency they import', () => {
  const isTest = (file: string): boolean => /\.(test|spec)\.tsx?$/.test(file);

  function publishedSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) publishedSources(path, out);
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !isTest(entry.name)) out.push(path);
    }
    return out;
  }

  /**
   * Bare import specifiers, read as syntax rather than by regex. `preProcessFile` is
   * TypeScript's own scanner-level import reader, so a comment or a string that happens
   * to contain the word `import` is out of the population by construction.
   */
  function bareSpecifiers(source: string): string[] {
    const found: string[] = [];
    for (const ref of ts.preProcessFile(source, true, true).importedFiles) {
      const specifier = ref.fileName;
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (specifier.startsWith('node:')) continue;
      const parts = specifier.split('/');
      found.push(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!);
    }
    return found;
  }

  it('imports nothing it does not declare as a runtime dependency', () => {
    const undeclared: string[] = [];
    let read = 0;

    for (const { dir, manifest } of PACKAGES) {
      const runtime = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      for (const file of publishedSources(join(dir, 'src'))) {
        read += 1;
        for (const specifier of bareSpecifiers(readFileSync(file, 'utf8'))) {
          if (specifier === manifest.name || runtime.has(specifier)) continue;
          undeclared.push(`${manifest.name}: ${specifier} (${file.slice(ROOT!.length + 1)})`);
        }
      }
    }

    expect(read).toBeGreaterThan(0);
    expect([...new Set(undeclared)].sort()).toEqual([]);
  });

  it('reads imports as syntax, not as prose', () => {
    // The regex version of this analysis reported `no such` and `not asked about` as
    // packages, from sentences in `@b2b/contracts`' own doc comments.
    const source = [
      "// An operator asked about `import { thing } from 'not-a-package'` and was",
      '// told no.',
      "const sql = \"import from 'also-not-a-package'\";",
      "import { real } from 'a-real-package';",
      'export { real, sql };',
    ].join('\n');

    expect(bareSpecifiers(source)).toEqual(['a-real-package']);
  });
});

/**
 * The only assertion here that can tell a correct `dist` from one whose declarations
 * degraded to `any`.
 *
 * A consumer outside the workspace resolves `@b2b/*` through node_modules and the
 * packages' own `exports` maps — no `paths`, no source — and asserts a bad member of a
 * `z.infer` union under `@ts-expect-error`. If the union became `any` the directive is
 * unused and `tsc` reports TS2578. Measured: with `zod` unresolvable from the built
 * package, that is exactly what happens, and every other test in this file stays green.
 */
describe('the built declarations are real types, not `any`', () => {
  it('rejects a bad union member read from the built d.ts', () => {
    const consumer = mkdtempSync(join(tmpdir(), 't042-consumer-'));
    try {
      mkdirSync(join(consumer, 'node_modules', '@b2b'), { recursive: true });
      mkdirSync(join(consumer, 'src'), { recursive: true });
      for (const { dir, manifest } of PACKAGES) {
        symlinkSync(dir, join(consumer, 'node_modules', manifest.name!));
      }
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 't042-consumer', type: 'module', private: true }),
      );
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2022', 'DOM'],
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      writeFileSync(
        join(consumer, 'src', 'probe.ts'),
        [
          "import type { ProductType } from '@b2b/contracts';",
          "import { productTypeSchema } from '@b2b/contracts';",
          "import type { ResponsiveProp } from '@b2b/page-builder-core/types/responsive';",
          '',
          "export const good: ProductType = 'configurable';",
          '// @ts-expect-error not a member of the ProductType union',
          "export const bad: ProductType = 'not-a-product-type';",
          "export const parsed: ProductType = productTypeSchema.parse('simple');",
          '',
          'export const responsive: ResponsiveProp<number> = { base: 1 };',
          '// @ts-expect-error ResponsiveProp<number> does not accept a string',
          "export const badResponsive: ResponsiveProp<number> = { base: 'one' };",
          '',
        ].join('\n'),
      );

      const tsc = join(ROOT!, 'node_modules', '.bin', 'tsc');
      let output = '';
      let status = 0;
      try {
        execFileSync(tsc, ['-p', 'tsconfig.json'], { cwd: consumer, encoding: 'utf8' });
      } catch (error) {
        const failure = error as { stdout?: string; status?: number };
        output = failure.stdout ?? String(error);
        status = failure.status ?? 1;
      }

      expect(output.trim()).toBe('');
      expect(status).toBe(0);
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  }, 60_000);
});
