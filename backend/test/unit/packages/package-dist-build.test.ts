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
 *    `describe` below them is the only thing here that does not.
 * 5. **The built declarations compile under `moduleResolution: NodeNext`** (D-162), which
 *    is what `tsc --init` writes and therefore what a third-party author actually has.
 *    Property 4 compiles under `Bundler` — this repository's own setting — and `Bundler`
 *    is the lenient model: it accepts declarations that describe a CJS package as if it
 *    had an ESM default export. NodeNext does not, and the resulting `TS2709` lands
 *    *inside the published `.d.ts`*, where the consumer cannot fix it.
 *
 * The manifest analysis takes a manifest **object**, so each red proof enters above the
 * predicate rather than being handed a finding somebody already computed.
 *
 * ## What this file learned on 2026-08-28, and why the four repairs are one commit
 *
 * Its population was a one-level `readdirSync` of `packages/`, so it saw the six
 * top-level packages and **no module package at all** — 65 of them, one more with every
 * conversion, and `packages/modules` skipped whole because it carries no manifest.
 * Repairing that alone would have printed a bigger number and refused the same nothing,
 * three times over, so all four repairs land together
 * (`specs/080-f4-real-scope/package-dist-build-population.md`, D-181):
 *
 *   * **The population is the workspace's own.** `classifyWorkspaceMembers` over the
 *     `pnpm-workspace.yaml` globs, filtered to the *family* — a glob entry enumerates a
 *     library family, a literal entry names one deployable — which is the same
 *     derivation `check:release-intent` asks its own question of.
 *   * **The surface is every declared subpath, not the root.** A module package's root
 *     subpath is its *manifest*; the entities, the ports and every emitted `ioredis`
 *     reference live under `./backend`. Measured by injecting D-162's own defect into a
 *     package's `dist`: with the population repaired and the root subpath alone probed,
 *     this file stayed **green**. The control below reproduces that, so the vacuity
 *     cannot come back in silence. Dropping the old `exports['.'] !== undefined` filter
 *     also puts `@endora-commerce/platform` in the population for the first time — the
 *     package D-162's own worked example is written about had never been compiled by
 *     this gate.
 *   * **A killed compiler is not a clean one.** Property 5 read the failed child's
 *     `stdout` and never its **signal**, so a SIGKILLed `tsc` — which has written
 *     nothing, because it buffers diagnostics to the end of the check phase — yielded
 *     `[]` and passed. The repair takes that child from 701 MB to 1280 MB of peak RSS,
 *     so the read is a precondition and not a follow-up. Every spawn here now goes
 *     through `test/helpers/check-process.ts`, whose `CheckTermination` keeps `exit`,
 *     `signal` and `unspawned` apart by construction.
 *   * **D-181**: *if a specifier survives into a package's emitted `.d.ts`, that package
 *     declares it as a real dependency.* `tsc` copies the import into the declarations
 *     verbatim, so a consumer type-checking the package must resolve it — and a
 *     `devDependency` is not installed for one. Property 3 therefore reads the emitted
 *     declarations as well as the sources, and D-171's type-only-at-contract-surface
 *     exemption survives only for a reach that does **not** survive into them.
 */

import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCheck, type SpawnedCheck } from '../../helpers/check-process.js';
import {
  emittedDeclarationSpecifiers,
  firstNonContractReach,
  nodeManifestFs,
  peerNamesOf,
  type EmittedDeclarations,
} from '../../../scripts/lib/module-package-manifest.js';
import { readEmitLayout } from '../../../scripts/lib/module-packages.js';
import {
  modulePackageSurfaces,
  type ModulePackageSurfaces,
} from '../../../scripts/lib/module-package-subpaths.js';
import {
  classifyWorkspaceMembers,
  modulePackages,
  nodeWorkspaceFs,
} from '../../../scripts/lib/workspace-packages.js';
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
  readonly name: string;
  readonly manifest: PackageManifest;
}

type FindingKind =
  | 'main-outside-dist'
  | 'types-outside-dist'
  | 'main-without-root-export'
  | 'types-without-root-export'
  | 'legacy-fallback-incomplete'
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
  //
  // **Declaring them at all is optional, and that is a correction of 2026-08-28.** This
  // rule read "a root export requires both, under `dist`", which was true of the six
  // top-level packages it was written over and false of the 65 module packages it could
  // not see: `module-package-layout.md` §2 enumerates a module package's manifest and it
  // has neither field, deliberately. Nothing is lost by the omission — `main` and `types`
  // are what a resolver that cannot read `exports` falls back to, and such a resolver
  // cannot reach `<pkg>/backend` or `<pkg>/migrations` either, so a root-only fallback
  // answers a consumer who is already stuck. What is *not* optional is the pair: one
  // without the other hands a legacy resolver JavaScript with no declarations, or
  // declarations with no JavaScript, which is this file's own subject — a consumer
  // reading a different file from the one it executes.
  const hasRootExport = Object.keys(manifest.exports ?? {}).includes('.');
  if (hasRootExport) {
    if (manifest.main !== undefined && !inDist(manifest.main)) {
      findings.push({ kind: 'main-outside-dist', detail: manifest.main });
    }
    if (manifest.types !== undefined && !inDist(manifest.types)) {
      findings.push({ kind: 'types-outside-dist', detail: manifest.types });
    }
    if ((manifest.main === undefined) !== (manifest.types === undefined)) {
      findings.push({
        kind: 'legacy-fallback-incomplete',
        detail: `main=${manifest.main ?? '<absent>'} types=${manifest.types ?? '<absent>'}`,
      });
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

/**
 * The packages this file judges: every workspace member a *glob* entry produced.
 *
 * Derived rather than walked (feature 080, T042; repaired 2026-08-28). What this replaces
 * was `readdirSync('packages')`, one level — the right question asked at the wrong depth,
 * and it answered by **silence**: `packages/modules` carries no `package.json`, so it was
 * skipped along with every module package under it, and all five properties below were
 * vacuous for 65 of the 71 packages this repository ships.
 * `classifyWorkspaceMembers` is the same derivation `check:release-intent` uses, and its
 * family/application split is the workspace file's own: a glob enumerates a library
 * family, a literal names one deployable.
 */
function distributedPackages(root: string): WorkspacePackage[] {
  const { members } = classifyWorkspaceMembers(root, nodeWorkspaceFs());
  return members
    .filter((member) => member.family)
    .map((member) => ({
      dir: member.dir,
      name: member.name,
      manifest: member.manifest as unknown as PackageManifest,
    }));
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

const PACKAGES = ROOT === null ? [] : distributedPackages(ROOT);

/** The module packages among them, by npm name, for the D-171 surfaces predicate. */
const MODULE_PACKAGE_DIRECTORIES: ReadonlyMap<string, string> =
  ROOT === null
    ? new Map()
    : new Map(
        modulePackages(classifyWorkspaceMembers(ROOT, nodeWorkspaceFs()).members).map(
          (entry) => [entry.name, entry.dir] as const,
        ),
      );

describe('package distribution shape', () => {
  it('is a checkout of this repository, with packages in it', () => {
    expect(ROOT).not.toBeNull();
    expect(PACKAGES.length).toBeGreaterThan(0);
  });

  it('reaches the module packages, not only the top-level six', () => {
    // The population defect this file carried until 2026-08-28, asserted as a property
    // rather than as a count: `packages/modules/*` is a workspace glob, so a member under
    // it is family exactly as `packages/*`'s members are. A count would be a derived fact
    // written down (D-100) and would be stale at the next conversion.
    expect(MODULE_PACKAGE_DIRECTORIES.size).toBeGreaterThan(0);
    const names = PACKAGES.map((entry) => entry.name);
    for (const [name, dir] of MODULE_PACKAGE_DIRECTORIES) {
      expect(names).toContain(name);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
    }
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

    it('passes a root export with no legacy fallback at all', () => {
      // Every module package's shape (`module-package-layout.md` §2): an `exports` map and
      // nothing else. A resolver that cannot read the map could not reach `./backend`
      // either, so there is nothing for a root-only `main` to rescue.
      const { main, types, ...rest } = sound;
      expect(main).toBe('./dist/index.js');
      expect(types).toBe('./dist/index.d.ts');
      expect(distShapeFindings(rest)).toEqual([]);
    });

    it('refuses half a legacy fallback', () => {
      // JavaScript with no declarations for a `node10` consumer — this file's own subject,
      // arriving through the field `exports` was supposed to replace.
      const { types: _types, ...mainOnly } = sound;
      const { main: _main, ...typesOnly } = sound;
      expect(distShapeFindings(mainOnly).map((f) => f.kind)).toEqual([
        'legacy-fallback-incomplete',
      ]);
      expect(distShapeFindings(typesOnly).map((f) => f.kind)).toEqual([
        'legacy-fallback-incomplete',
      ]);
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

/**
 * Property 3, in the two halves D-181 splits it into.
 *
 * The **sources** half is the original: a bare specifier a published source imports is a
 * specifier a consumer's install has to resolve, and a `devDependency` is not installed
 * for one. D-171 exempts a type-only import at a subpath whose emitted module exports no
 * runtime binding, on the reasoning that such a reach is erased and npm need not know
 * about it.
 *
 * The **declarations** half is D-181's, and it is what makes that exemption honest.
 * `tsc` copies an `import type` into the emitted `.d.ts` verbatim whenever the type it
 * names appears in an exported signature: the reach is erased from the JavaScript and
 * survives into the declarations, where a consumer type-checking the package must resolve
 * it. When it cannot, every type flowing through it becomes `any` — with **no diagnostic
 * at all** under the `skipLibCheck: true` that `tsc --init` writes. So a surviving
 * specifier is a real dependency whatever shape it was written in, and D-171's exemption
 * applies only to a reach that does not survive.
 */
type DependencyFindingKind = 'undeclared-import' | 'undeclared-in-published-declarations';

interface DependencyFinding {
  readonly kind: DependencyFindingKind;
  readonly detail: string;
}

/** Everything one package fails to declare, over both populations. */
export interface DependencyAnalysisInput {
  readonly name: string;
  readonly manifest: PackageManifest;
  /** The published sources, keyed by a package-relative path, as text. */
  readonly sources: ReadonlyMap<string, string>;
  /** What the build actually emitted, or `null` for a package that has none. */
  readonly emitted: EmittedDeclarations | null;
  readonly modulePackageNames: ReadonlySet<string>;
  readonly surfaces: ModulePackageSurfaces;
}

/**
 * Pure over what it is handed — the manifest, the sources as text, and the specifiers the
 * build emitted — so a red proof enters at the top of the analysis with a whole synthetic
 * package rather than at the bottom with a finding somebody computed (issue #130).
 */
export function dependencyFindings(input: DependencyAnalysisInput): DependencyFinding[] {
  const runtime = new Set([
    ...Object.keys(input.manifest.dependencies ?? {}),
    ...Object.keys(input.manifest.peerDependencies ?? {}),
  ]);
  const findings: DependencyFinding[] = [];

  const published: ReadonlyMap<string, readonly string[]> =
    input.emitted?.names ?? new Map<string, readonly string[]>();
  for (const [name, written] of published) {
    if (name === input.name || runtime.has(name)) continue;
    findings.push({
      kind: 'undeclared-in-published-declarations',
      detail:
        `${input.name}: ${name} survives into the emitted declarations as ` +
        `${written.join(', ')} and is not a runtime dependency (D-181)`,
    });
  }

  for (const [name, reaches] of peerNamesOf(input.sources)) {
    if (name === input.name || runtime.has(name)) continue;
    // Already reported above, with the stronger reason. One reach, one finding: a
    // specifier that survives is not *also* an undeclared import.
    if (published.has(name)) continue;
    if (
      input.modulePackageNames.has(name) &&
      firstNonContractReach(name, reaches, input.surfaces) === null
    ) {
      continue;
    }
    const first = reaches[0];
    findings.push({
      kind: 'undeclared-import',
      detail: `${input.name}: ${name} (${first?.file}:${first?.line})`,
    });
  }

  return findings;
}

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

  it('imports nothing it does not declare as a runtime dependency', () => {
    const surfaces = modulePackageSurfaces(MODULE_PACKAGE_DIRECTORIES);
    const modulePackageNames = new Set(MODULE_PACKAGE_DIRECTORIES.keys());
    const fs = nodeManifestFs();
    const undeclared: string[] = [];
    const sourcesPerPackage: Record<string, number> = {};
    const declarationsPerPackage: Record<string, number> = {};
    let read = 0;

    for (const { dir, name, manifest } of PACKAGES) {
      const files = publishedSources(dir);
      sourcesPerPackage[name] = files.length;
      const sources = new Map<string, string>();
      for (const file of files) {
        read += 1;
        sources.set(relative(dir, file), readFileSync(file, 'utf8'));
      }

      const emit = readEmitLayout(dir, name, fs);
      const emitted = emit === null ? null : emittedDeclarationSpecifiers(dir, emit.outDir, fs);
      declarationsPerPackage[name] = emitted?.files ?? 0;

      for (const finding of dependencyFindings({
        name,
        manifest,
        sources,
        emitted,
        modulePackageNames,
        surfaces,
      })) {
        undeclared.push(finding.detail);
      }
    }

    // The floor is **per package**, not per run (issue #215): a handful of packages
    // contributing hundreds of files each keep `read` comfortably positive while a
    // seventy-first contributes nothing, and a package this analysis did not open is a
    // package with no check at all. The second floor is D-181's own population: a package
    // whose build emitted no declaration has no answer to "what survives into what it
    // publishes", and taking that silence for "nothing does" is the vacuity this whole
    // repair is about.
    expect(read).toBeGreaterThan(0);
    expect(Object.entries(sourcesPerPackage).filter(([, count]) => count === 0)).toEqual([]);
    expect(Object.entries(declarationsPerPackage).filter(([, count]) => count === 0)).toEqual([]);
    expect([...new Set(undeclared)].sort()).toEqual([]);
  }, 120_000);

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

    expect([...peerNamesOf(new Map([['probe.ts', source]])).keys()]).toEqual(['a-real-package']);
  });

  describe('dependencyFindings refuses each shape it names', () => {
    const sound: DependencyAnalysisInput = {
      name: '@example/consumer',
      manifest: { name: '@example/consumer', peerDependencies: { zod: '^4' } },
      sources: new Map([['src/index.ts', "import { z } from 'zod';\nexport const s = z;\n"]]),
      emitted: { names: new Map([['zod', ["'zod'"]]]), files: 1 },
      modulePackageNames: new Set<string>(),
      surfaces: modulePackageSurfaces(new Map()),
    };

    it('passes a package that declares what it imports and publishes', () => {
      expect(dependencyFindings(sound)).toEqual([]);
    });

    it('refuses a specifier that survives into the emitted declarations undeclared', () => {
      // D-181's own defect, in the smallest shape that carries it: the specifier is a
      // devDependency, so it resolves here and resolves for nobody who installs the
      // package — and the type it names becomes `any` with no diagnostic.
      const findings = dependencyFindings({
        ...sound,
        manifest: { name: '@example/consumer' },
        sources: new Map(),
        emitted: { names: new Map([['@example/owner', ["'@example/owner/ports'"]]]), files: 1 },
      });
      expect(findings.map((f) => f.kind)).toEqual(['undeclared-in-published-declarations']);
      expect(findings[0]?.detail).toContain('@example/owner/ports');
    });

    it('refuses a source import of something declared nowhere', () => {
      const findings = dependencyFindings({
        ...sound,
        manifest: { name: '@example/consumer' },
        emitted: { names: new Map(), files: 1 },
      });
      expect(findings.map((f) => f.kind)).toEqual(['undeclared-import']);
      expect(findings[0]?.detail).toContain('zod');
    });

    it('reports a surviving specifier once, as the published-declaration finding', () => {
      const findings = dependencyFindings({ ...sound, manifest: { name: '@example/consumer' } });
      expect(findings.map((f) => f.kind)).toEqual(['undeclared-in-published-declarations']);
    });
  });

  describe("D-171's exemption survives only where the reach does not", () => {
    /**
     * A whole owner package on disk, so the surfaces predicate reads a real `exports` map
     * and a real emitted module rather than being handed a verdict (issue #130).
     */
    function withOwner(
      runtimeExport: string,
      body: (surfaces: ModulePackageSurfaces) => void,
    ): void {
      const owner = mkdtempSync(join(tmpdir(), 'd171-owner-'));
      try {
        mkdirSync(join(owner, 'dist', 'ports'), { recursive: true });
        writeFileSync(
          join(owner, 'package.json'),
          JSON.stringify({
            name: '@example/owner',
            exports: {
              './ports': { types: './dist/ports/index.d.ts', default: './dist/ports/index.js' },
            },
          }),
        );
        writeFileSync(join(owner, 'dist', 'ports', 'index.js'), runtimeExport);
        body(modulePackageSurfaces(new Map([['@example/owner', owner]])));
      } finally {
        rmSync(owner, { recursive: true, force: true });
      }
    }

    const source = "import type { Port } from '@example/owner/ports';\nexport type P = Port;\n";
    const consumer = {
      name: '@example/consumer',
      manifest: { name: '@example/consumer' } as PackageManifest,
      sources: new Map([['src/index.ts', source]]),
      modulePackageNames: new Set(['@example/owner']),
    };

    it('exempts a type-only reach at contract surface that does not survive', () => {
      withOwner('export {};\n', (surfaces) => {
        expect(
          dependencyFindings({ ...consumer, emitted: { names: new Map(), files: 1 }, surfaces }),
        ).toEqual([]);
      });
    });

    it('refuses the same reach once it survives into the declarations (D-181)', () => {
      withOwner('export {};\n', (surfaces) => {
        const findings = dependencyFindings({
          ...consumer,
          emitted: { names: new Map([['@example/owner', ["'@example/owner/ports'"]]]), files: 1 },
          surfaces,
        });
        expect(findings.map((f) => f.kind)).toEqual(['undeclared-in-published-declarations']);
      });
    });

    it('refuses a type-only reach at a subpath that exports a runtime binding', () => {
      withOwner('export const registerModule = () => {};\n', (surfaces) => {
        const findings = dependencyFindings({
          ...consumer,
          emitted: { names: new Map(), files: 1 },
          surfaces,
        });
        expect(findings.map((f) => f.kind)).toEqual(['undeclared-import']);
      });
    });
  });
});

/**
 * Every subpath of a package a consumer can name, and therefore every subpath a probe has
 * to compile (feature 080; the repair of 2026-08-28).
 *
 * `export * from '<package name>'` reaches the **root** subpath and nothing else. For the
 * six top-level packages the root is most of the surface; for a module package the root is
 * `./dist/manifest.d.ts` — the lifecycle manifest — while the entities, the services, the
 * ports and every emitted `ioredis` reference live under `./backend` and `./migrations`.
 * A probe of the root alone is a gate that reads clean over the layer the ruling is about,
 * which the control below measures rather than asserts.
 *
 * Wildcard entries are outside the rule: `"./components/*"` names no single file to
 * compile. So is a bare string target — the compiled stylesheet has no declarations.
 */
export interface ProbedSubpath {
  readonly subpath: string;
  /** What a consumer writes: `@scope/pkg` or `@scope/pkg/backend`. */
  readonly specifier: string;
}

export function typedSubpaths(name: string, manifest: PackageManifest): ProbedSubpath[] {
  const found: ProbedSubpath[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath.includes('*')) continue;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) continue;
    const types = (target as Record<string, unknown>)['types'];
    if (typeof types !== 'string') continue;
    found.push({
      subpath,
      specifier: subpath === '.' ? name : `${name}/${subpath.replace(/^\.\//, '')}`,
    });
  }
  return found;
}

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
  it('rejects a bad union member read from the built d.ts', async () => {
    const consumer = mkdtempSync(join(tmpdir(), 't042-consumer-'));
    try {
      mkdirSync(join(consumer, 'src'), { recursive: true });
      for (const { dir, name } of PACKAGES) {
        const target = join(consumer, 'node_modules', name);
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(dir, target);
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

      // Through the spawn helper for the reason property 5 needs it: a child the kernel
      // killed printed nothing, and "it printed nothing" is what a clean run looks like.
      const seen = await spawnCheck(
        join(ROOT!, 'node_modules', '.bin', 'tsc'),
        ['-p', 'tsconfig.json', '--pretty', 'false'],
        { cwd: consumer },
      );

      expect(seen.output.trim()).toBe('');
      expect(seen.termination).toEqual({ kind: 'exit', code: 0 });
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  }, 180_000);
});

/**
 * D-162 — the same built `dist`, compiled by a consumer configured the way `tsc --init`
 * configures one.
 *
 * The probe above uses `moduleResolution: Bundler`, which is this repository's setting and
 * the lenient of the two models. `tsc --init` on TypeScript 5.9 writes
 * `"module": "nodenext"`, so a third-party author's starting point is the strict one — and
 * the two disagree about a package whose declarations do not describe its own runtime.
 * `ioredis` is the worked example and the reason this exists: `built/index.js` reassigns
 * `module.exports` to the class while `built/index.d.ts` writes `export { default }`, so
 * under NodeNext the default binding is the module namespace, which has no type meaning.
 * `tsc` copies an import into the declarations it emits verbatim, so a platform source that
 * writes `import type Redis from 'ioredis'` publishes `TS2709` into its own `.d.ts` — an
 * error inside a dependency, which the author who hits it cannot repair.
 *
 * Three properties, and the first is the control: it builds a package that carries each
 * spelling and measures which one a strict consumer refuses. Without it the last test is
 * the shape that cannot go red, because no package in this repository imports `ioredis`
 * *today* and one that never can proves nothing about the one that will.
 *
 * `skipLibCheck` is `false` here — with it on, the error is invisible, which is exactly how
 * a published defect of this shape survives. Diagnostics are then filtered to the probed
 * packages' **own** files: a strict consumer with no `@types/node` also reports a
 * `NodeJS`-namespace reference inside `@measured/puck`, and this asserts a property of what
 * *this repository emits*, not of its transitive declaration graph. The filter is derived
 * from the package directories under test, never a list of tolerated files.
 */
describe('the built declarations compile under `moduleResolution: NodeNext` (D-162)', () => {
  interface ProbedPackage {
    readonly name: string;
    readonly dir: string;
  }

  /**
   * The diagnostics a finished `tsc` reported inside the probed packages.
   *
   * **A child that did not finish is not a clean one.** `tsc` buffers its diagnostics and
   * writes them at the end of the check phase, so one the kernel killed mid-check has
   * written nothing at all — and this function's caller used to read that silence as an
   * empty diagnostic set and pass. That is the disguise `test/helpers/check-process.ts`
   * exists for, in a probe whose child this repair took from 701 MB to 1280 MB of peak
   * RSS. The termination is therefore read *before* the output, and anything but an exit
   * throws.
   */
  function ownedDiagnostics(
    seen: SpawnedCheck,
    consumer: string,
    owned: readonly string[],
  ): string[] {
    if (seen.termination.kind !== 'exit') {
      throw new Error(
        seen.termination.kind === 'signal'
          ? `the NodeNext probe's compiler was killed by ${seen.termination.signal} after ` +
            `printing ${seen.bytes} byte(s). It reached no verdict of its own, so this says ` +
            `nothing about what the packages emit and everything about what it was run ` +
            `inside — the probe's own child peaks around 1.3 GB, which on a memory-limited ` +
            `runner is the OOM killer. Reading its empty output as "no diagnostics" is the ` +
            `fail-open this read exists to close.`
          : `the NodeNext probe's compiler could not be spawned: ${seen.termination.reason}`,
      );
    }
    return seen.output
      .split('\n')
      .filter((line) => /error TS\d+/.test(line))
      .filter((line) => {
        const path = line.slice(0, line.lastIndexOf('('));
        let real: string;
        try {
          real = realpathSync(resolve(consumer, path));
        } catch {
          return false;
        }
        return owned.some((dir) => real.startsWith(dir));
      })
      .map((line) => line.trim());
  }

  /**
   * A strict NodeNext consumer outside the workspace, over the given packages, returning
   * only the diagnostics that land inside one of those packages.
   */
  async function nodeNextDiagnostics(
    packages: readonly ProbedPackage[],
    sources: Readonly<Record<string, string>>,
    alsoLink: Readonly<Record<string, string>> = {},
  ): Promise<string[]> {
    const consumer = mkdtempSync(join(tmpdir(), 'd162-nodenext-'));
    try {
      mkdirSync(join(consumer, 'src'), { recursive: true });
      for (const [name, dir] of [
        ...packages.map((p) => [p.name, p.dir] as const),
        ...Object.entries(alsoLink),
      ]) {
        const target = join(consumer, 'node_modules', name);
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(dir, target);
      }
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'd162-consumer', type: 'module', private: true }),
      );
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2022', 'DOM'],
            jsx: 'react-jsx',
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      for (const [file, body] of Object.entries(sources)) {
        writeFileSync(join(consumer, 'src', file), body);
      }

      const seen = await spawnCheck(
        join(ROOT!, 'node_modules', '.bin', 'tsc'),
        ['-p', 'tsconfig.json', '--pretty', 'false'],
        { cwd: consumer },
      );
      return ownedDiagnostics(
        seen,
        consumer,
        packages.map((p) => realpathSync(p.dir) + sep),
      );
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  }

  /** One `export *` per probed subpath: `export *` pulls the whole declaration graph in. */
  function probeSources(probed: readonly ProbedSubpath[]): Record<string, string> {
    return Object.fromEntries(
      probed.map((entry, index) => [`p${index}.ts`, `export * from '${entry.specifier}';\n`]),
    );
  }

  it('refuses a package whose emitted declarations default-import ioredis, and accepts its named-import twin', async () => {
    // The fixture enters as *source*, and is emitted by a real `tsc` run configured the way
    // a package in this repository is configured — `Bundler`, which compiles both spellings
    // happily. Hand-writing the `.d.ts` would hand the consumer a value this control is
    // supposed to derive, and would not show that `tsc` copies the import through.
    //
    // Its shape carries the second half of the control (2026-08-28): the defect is under a
    // **non-root** subpath, exactly where a module package's entities and every emitted
    // `ioredis` reference live, and the root subpath is clean. The `rootOnly` assertion is
    // the one that fails if this file's population is ever repaired without its surface —
    // probing the root alone reports the package clean while its published `./backend`
    // declarations carry the error D-162 exists to refuse.
    const fixture = mkdtempSync(join(tmpdir(), 'd162-host-'));
    try {
      mkdirSync(join(fixture, 'src'), { recursive: true });
      mkdirSync(join(fixture, 'node_modules'), { recursive: true });
      symlinkSync(join(ROOT!, 'backend', 'node_modules', 'ioredis'), join(fixture, 'node_modules', 'ioredis'));
      const manifest: PackageManifest = {
        name: '@d162/fixture-host',
        exports: {
          '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' },
          './backend': { types: './dist/backend.d.ts', default: './dist/backend.js' },
          './named-import': { types: './dist/named-import.d.ts', default: './dist/named-import.js' },
          './package.json': './package.json',
        },
      };
      writeFileSync(
        join(fixture, 'package.json'),
        JSON.stringify({ ...manifest, version: '0.0.0', type: 'module', private: true }),
      );
      writeFileSync(
        join(fixture, 'src', 'manifest.ts'),
        'export interface FixtureManifest { readonly id: string }\n',
      );
      writeFileSync(
        join(fixture, 'src', 'backend.ts'),
        "import type Redis from 'ioredis';\nexport interface DefaultImportContext { readonly redis: Redis }\n",
      );
      writeFileSync(
        join(fixture, 'src', 'named-import.ts'),
        "import type { Redis } from 'ioredis';\nexport interface NamedImportContext { readonly redis: Redis }\n",
      );
      writeFileSync(
        join(fixture, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2022'],
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            declaration: true,
            rootDir: './src',
            outDir: './dist',
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      const built = await spawnCheck(
        join(ROOT!, 'node_modules', '.bin', 'tsc'),
        ['-p', 'tsconfig.json', '--pretty', 'false'],
        { cwd: fixture },
      );
      expect(built.termination).toEqual({ kind: 'exit', code: 0 });

      // `tsc` published the spelling it was given, unchanged.
      expect(readFileSync(join(fixture, 'dist', 'backend.d.ts'), 'utf8')).toContain(
        "import type Redis from 'ioredis'",
      );

      const probed: ProbedPackage[] = [{ name: '@d162/fixture-host', dir: fixture }];
      const links = { ioredis: join(ROOT!, 'backend', 'node_modules', 'ioredis') };
      const subpaths = typedSubpaths('@d162/fixture-host', manifest);
      expect(subpaths.map((entry) => entry.subpath)).toEqual(['.', './backend', './named-import']);

      const everySubpath = await nodeNextDiagnostics(probed, probeSources(subpaths), links);
      expect(everySubpath.join('\n')).toContain('error TS2709');
      expect(everySubpath).toHaveLength(1);

      // The population-only repair, measured rather than argued: probing the root subpath
      // alone — which is what `export * from '<package name>'` does, and all this file did
      // until 2026-08-28 — reports the same package clean.
      const rootOnly = await nodeNextDiagnostics(
        probed,
        probeSources(subpaths.filter((entry) => entry.subpath === '.')),
        links,
      );
      expect(rootOnly).toEqual([]);

      const named = await nodeNextDiagnostics(
        probed,
        probeSources(subpaths.filter((entry) => entry.subpath === './named-import')),
        links,
      );
      expect(named).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 300_000);

  it('reads a killed compiler as a killed compiler, not as a clean one', async () => {
    // §6's fail-open, reproduced with a child the kernel really kills rather than with a
    // hand-built record: the fixture enters at the top of the analysis. `tsc` writes its
    // diagnostics at the end of the check phase, so a child killed inside it has printed
    // nothing — which is exactly what this child does, and exactly what the previous
    // reading turned into `[]` and a passing assertion.
    const scratch = mkdtempSync(join(tmpdir(), 'd162-killed-'));
    try {
      const script = join(scratch, 'killed.mjs');
      writeFileSync(script, "process.kill(process.pid, 'SIGKILL');\n");
      const seen = await spawnCheck(process.execPath, [script], { cwd: scratch });

      expect(seen.termination.kind).toBe('signal');
      expect(seen.output).toBe('');
      expect(() => ownedDiagnostics(seen, scratch, [scratch + sep])).toThrow(/SIGKILL/);
      // And the reading it replaces, so the two are visibly different: the output alone
      // parses to nothing, which is what made the assertion pass.
      expect(seen.output.split('\n').filter((line) => /error TS\d+/.test(line))).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("every workspace package's built dist compiles in a strict NodeNext consumer", async () => {
    const probed: ProbedPackage[] = PACKAGES.map(({ dir, name }) => ({ name, dir }));
    const subpathsPerPackage = new Map(
      PACKAGES.map(({ name, manifest }) => [name, typedSubpaths(name, manifest)] as const),
    );
    const everySubpath = [...subpathsPerPackage.values()].flat();

    // Two floors, both per package rather than per run (issue #215). A package the
    // population dropped and a package whose every subpath is a wildcard are the same
    // silence — a package with no gate at all — and seventy others contributing two
    // hundred subpaths between them keep any per-run count comfortably positive.
    expect(probed.length).toBeGreaterThan(0);
    expect([...subpathsPerPackage].filter(([, entries]) => entries.length === 0)).toEqual([]);
    expect(everySubpath.length).toBeGreaterThan(probed.length);

    expect(await nodeNextDiagnostics(probed, probeSources(everySubpath))).toEqual([]);
  }, 600_000);
});
