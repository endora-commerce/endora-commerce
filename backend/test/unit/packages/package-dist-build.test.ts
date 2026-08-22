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
 *    found five in `@endora-commerce/cms-components` — four Tiptap extensions and `leaflet`.
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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { isBuiltin } from 'node:module';
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
  | 'main-without-root-export'
  | 'types-without-root-export'
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

  // `main` and `types` are the *root* entry point, so what they must be depends on whether
  // the package has one. Four of the five packages under `packages/` do; the host package
  // (feature 080, T042a) deliberately does not — D-160.7 gives it five enumerated subpaths
  // and no `.`, because there is no sensible answer to "what does the whole platform
  // export" and an unexported root produces `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than a
  // plausible guess. For that package a `main` would be worse than redundant: it is the
  // fallback a CJS or `moduleResolution: Bundler` consumer takes when `exports` has no
  // matching subpath, so declaring one re-opens by the back door the root the map refuses.
  const hasRootExport = Object.keys(manifest.exports ?? {}).includes('.');
  if (hasRootExport) {
    if (manifest.main === undefined || !inDist(manifest.main)) {
      findings.push({ kind: 'main-outside-dist', detail: manifest.main ?? '<absent>' });
    }
    if (manifest.types === undefined || !inDist(manifest.types)) {
      findings.push({ kind: 'types-outside-dist', detail: manifest.types ?? '<absent>' });
    }
  } else {
    if (manifest.main !== undefined) {
      findings.push({ kind: 'main-without-root-export', detail: manifest.main });
    }
    if (manifest.types !== undefined) {
      findings.push({ kind: 'types-without-root-export', detail: manifest.types });
    }
  }
  if (!(manifest.files ?? []).includes('dist')) {
    findings.push({ kind: 'files-missing-dist', detail: JSON.stringify(manifest.files ?? null) });
  }
  if (manifest.scripts?.['build'] === undefined) {
    findings.push({ kind: 'no-build-script', detail: '<absent>' });
  }

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    // The one subpath whose target is *not* under `dist` and cannot be: it is the manifest
    // itself. A consumer resolving `<pkg>/package.json` — a version read, a tool locating
    // the install — needs it exported, and it has no declarations to condition on.
    if (subpath === './package.json') continue;
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
      name: '@endora-commerce/example',
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
        exports: { ...sound.exports, './*': { types: './src/*.ts', default: './src/*.ts' } },
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
        distShapeFindings({
          ...sound,
          exports: { ...sound.exports, './styles.css': './dist/example.css' },
        }),
      ).toEqual([]);
    });

    it('refuses a missing `files` entry', () => {
      expect(distShapeFindings({ ...sound, files: ['src'] }).map((f) => f.kind)).toEqual([
        'files-missing-dist',
      ]);
    });

    it('passes a root-less map that declares no `main`', () => {
      // The host package's shape: five enumerated subpaths, no `.`, no `main`, no `types`.
      const rootless: PackageManifest = {
        name: '@endora-commerce/platform',
        files: ['dist'],
        scripts: { build: 'tsc -p tsconfig.build.json' },
        exports: {
          './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
          './package.json': './package.json',
        },
      };
      expect(distShapeFindings(rootless)).toEqual([]);
    });

    it('refuses a `main` beside a map with no root export', () => {
      const rootless: PackageManifest = {
        name: '@endora-commerce/platform',
        main: './dist/kernel/index.js',
        files: ['dist'],
        scripts: { build: 'tsc -p tsconfig.build.json' },
        exports: {
          './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
        },
      };
      expect(distShapeFindings(rootless).map((f) => f.kind)).toEqual(['main-without-root-export']);
    });

    it('refuses a `types` beside a map with no root export', () => {
      const rootless: PackageManifest = {
        name: '@endora-commerce/platform',
        types: './dist/kernel/index.d.ts',
        files: ['dist'],
        scripts: { build: 'tsc -p tsconfig.build.json' },
        exports: {
          './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
        },
      };
      expect(distShapeFindings(rootless).map((f) => f.kind)).toEqual(['types-without-root-export']);
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
      // `rootDir` must be **declared**, and it is no longer required to be the literal
      // `./src`: the host package (feature 080, T042a) compiles `backend/src`'s five
      // platform directories where they live, with `rootDir` naming `backend/src`, so its
      // emitted layout is `dist/{kernel,http,tenancy,commands,events}` — the layout its
      // `exports` map names — without relocating 82 files that 1400-plus module files hold
      // relative specifiers into. What the literal was standing in for is asserted
      // directly below instead: every `exports` target is a file the build emits.
      const rootDir = build.compilerOptions?.['rootDir'];
      if (typeof rootDir !== 'string' || rootDir.length === 0) {
        defects.push(`${manifest.name}: tsconfig.build.json must declare a rootDir`);
      }
      if (build.compilerOptions?.['noEmit'] !== false) {
        defects.push(`${manifest.name}: tsconfig.build.json must re-enable emit`);
      }
      if (build.compilerOptions?.['noEmitOnError'] !== true) {
        defects.push(`${manifest.name}: tsconfig.build.json must set noEmitOnError`);
      }
      // The emit must exclude test files, wherever the exclusion is written: a compiled
      // `*.test.js` under `dist` imports `vitest`, a devDependency, so it is an
      // unresolvable specifier in every consumer's install. `tsconfig.build.json` extends
      // `tsconfig.json`, so an `exclude` in the parent is inherited — and an `exclude`
      // glob is resolved against the config's own directory, so a package whose sources
      // are elsewhere anchors the pattern there rather than writing `**/*.test.ts`.
      const excludes = [...(build.exclude ?? typecheck.exclude ?? [])];
      if (!excludes.some((pattern) => pattern.endsWith('*.test.ts'))) {
        defects.push(`${manifest.name}: the emit must exclude test files from dist`);
      }
      if (manifest.scripts?.['build']?.includes('tsconfig.build.json') !== true) {
        defects.push(`${manifest.name}: the build script must use tsconfig.build.json`);
      }
    }

    expect(PACKAGES.length).toBeGreaterThan(0);
    expect(defects).toEqual([]);
  });
});

describe('every `exports` target is a file the build emits', () => {
  // This is the property `rootDir === './src'` used to stand in for, asserted where it can
  // actually be wrong: the emitted layout is decided by `rootDir` and the `include` list
  // together, and a map naming a path the compiler never writes resolves to nothing at
  // runtime while `tsc` — answering from the `types` condition it also cannot find — says
  // nothing either. Needs the packages built; `pnpm run build:packages` precedes every CI
  // job that executes repository code.
  it('resolves every non-wildcard target on disk', () => {
    const missing: string[] = [];
    let checked = 0;

    for (const { dir, manifest } of PACKAGES) {
      const targets: string[] = [];
      for (const [, target] of Object.entries(manifest.exports ?? {})) {
        if (typeof target === 'string') targets.push(target);
        else {
          for (const value of Object.values(target as Record<string, unknown>)) {
            if (typeof value === 'string') targets.push(value);
          }
        }
      }
      for (const target of targets) {
        if (target.includes('*')) continue;
        checked += 1;
        if (!existsSync(join(dir, target))) missing.push(`${manifest.name}: ${target}`);
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});

describe('published sources declare every dependency they import', () => {
  const isTest = (file: string): boolean => /\.(test|spec)\.tsx?$/.test(file);

  function walkSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkSources(path, out);
      else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !isTest(entry.name)) out.push(path);
    }
    return out;
  }

  /**
   * The package's own sources, taken from the directories its type-check configuration
   * includes rather than from an assumed `./src`. The host package's are the five platform
   * directories of `backend/src` (feature 080, T042a), which is exactly the case an assumed
   * path answers wrongly — and it answers wrongly by *reading nothing*, which is a green
   * dependency check over a package that imports twenty things.
   */
  function publishedSources(dir: string): string[] {
    const config = readJsonc<{ include?: readonly string[] }>(join(dir, 'tsconfig.json'));
    const roots = new Set<string>();
    for (const pattern of config.include ?? []) {
      const head = pattern.split('*')[0]!;
      const resolved = join(dir, head.endsWith('/') ? head.slice(0, -1) : dirname(head));
      if (existsSync(resolved) && statSync(resolved).isDirectory()) roots.add(resolved);
    }
    const found: string[] = [];
    for (const root of roots) walkSources(root, found);
    return [...new Set(found)];
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
      // `isBuiltin` rather than a `node:` prefix test: the prefix is the spelling to
      // prefer, not the rule. `backend/src/kernel` writes bare `crypto` and `async_hooks`
      // in four files, and a package that declares neither is right not to.
      if (isBuiltin(specifier)) continue;
      const parts = specifier.split('/');
      found.push(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!);
    }
    return found;
  }

  it('imports nothing it does not declare as a runtime dependency', () => {
    const undeclared: string[] = [];
    const readPerPackage: Record<string, number> = {};
    let read = 0;

    for (const { dir, manifest } of PACKAGES) {
      const runtime = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      const sources = publishedSources(dir);
      readPerPackage[manifest.name!] = sources.length;
      for (const file of sources) {
        read += 1;
        for (const specifier of bareSpecifiers(readFileSync(file, 'utf8'))) {
          if (specifier === manifest.name || runtime.has(specifier)) continue;
          undeclared.push(`${manifest.name}: ${specifier} (${file.slice(ROOT!.length + 1)})`);
        }
      }
    }

    // The floor is **per package**, not per run (issue #215): five packages contributing
    // hundreds of files each keep `read` comfortably positive while a sixth contributes
    // nothing, and a package this analysis did not open is a package with no check at all.
    expect(read).toBeGreaterThan(0);
    expect(Object.entries(readPerPackage).filter(([, count]) => count === 0)).toEqual([]);
    expect([...new Set(undeclared)].sort()).toEqual([]);
  });

  it('reads imports as syntax, not as prose', () => {
    // The regex version of this analysis reported `no such` and `not asked about` as
    // packages, from sentences in `@endora-commerce/contracts`' own doc comments.
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
 * A consumer outside the workspace resolves `@endora-commerce/*` through node_modules and the
 * packages' own `exports` maps — no `paths`, no source — and asserts a bad member of a
 * `z.infer` union under `@ts-expect-error`. If the union became `any` the directive is
 * unused and `tsc` reports TS2578. Measured: with `zod` unresolvable from the built
 * package, that is exactly what happens, and every other test in this file stays green.
 */
describe('the built declarations are real types, not `any`', () => {
  it('rejects a bad union member read from the built d.ts', () => {
    const consumer = mkdtempSync(join(tmpdir(), 't042-consumer-'));
    try {
      mkdirSync(join(consumer, 'node_modules', '@endora-commerce'), { recursive: true });
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
          "import type { ProductType } from '@endora-commerce/contracts';",
          "import { productTypeSchema } from '@endora-commerce/contracts';",
          "import type { ResponsiveProp } from '@endora-commerce/page-builder-core/types/responsive';",
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
