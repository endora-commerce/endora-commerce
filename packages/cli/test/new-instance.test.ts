/**
 * `endora new instance` — the plan it builds and the eight refusals it makes
 * (`specs/110-instance-repository/` T132, T133).
 *
 * ## Why every refusal has a test of its own
 *
 * T133 in its own words: *"the refusal classes and their exit codes (R2.4),
 * each with a test"*. A refusal without a test is a refusal that will regress,
 * and the two ways it regresses are different: the **class** silently becomes
 * the other one — which is the whole of the exit-code contract, because a `2`
 * reported as a `1` tells an operator to fix an input the run never read — and
 * the **sentence** stops naming what to do instead, which `cli-surface.md` §2
 * requires of every one of them.
 *
 * So each case asserts three things: that it refused, the class it refused
 * under, and that its message names both the subject and the remedy.
 *
 * ## The fixtures enter at the top of the analysis
 *
 * Issue #130. Nothing below hands a pre-computed module set, a pre-classified
 * plan or a resolved host to the function that is supposed to compute it: the
 * refusals that need packages get a **fixture `node_modules`** on disk, built
 * by {@link installFixture}, which is the shape `acceptance:package-schema`
 * uses and the shape an installed consumer actually has. A fixture that entered
 * below the defect could not catch it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import { INSTANCE_BUILD_INPUTS } from '../src/lib/instance-build-inputs.js';

import {
  InstanceHostError,
  InstanceInputError,
  nextSteps,
  runNewInstance,
} from '../src/new-instance/index.js';
import { DEFAULT_TOPOLOGY } from '../src/new-instance/deploy.js';
import { npmrcContent } from '../src/new-storefront/npmrc.js';
import { resolveModuleSet, type ModuleCandidate } from '../src/new-instance/modules.js';
import {
  declaredEnvironmentInputs,
  devDependenciesFor,
  GENERATED_ARTEFACTS,
  planInstance,
  wiringLineCount,
  type PlanInput,
} from '../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';

const scratch: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ni-'));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** One package in a fixture `node_modules/@endora-commerce`. */
interface FixturePackage {
  readonly name: string;
  readonly version?: string;
  readonly endora?: Record<string, unknown>;
  /** The manifest object the package's root export exports as `manifest`. */
  readonly manifest?: Record<string, unknown>;
  /** Written verbatim instead of the manifest module, for the F7 proofs. */
  readonly rootSource?: string;
  /** Overrides the whole `exports` map, for the "no root export" proof. */
  readonly exports?: unknown;
  /** Extra files, relative to the package directory, written verbatim. */
  readonly files?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  /** Which of those a consumer supplies — §2.4's whole derivation reads it. */
  readonly peerDependenciesMeta?: Record<string, { optional: boolean }>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

/**
 * A directory whose `node_modules/@endora-commerce` holds the given packages.
 *
 * This is what the command reads, so the fixture is what an install produces
 * rather than a value the command would otherwise have computed.
 */
function installFixture(packages: readonly FixturePackage[]): string {
  const root = tempRoot();
  const scopeDir = join(root, 'node_modules', '@endora-commerce');
  for (const pkg of packages) {
    const dir = join(scopeDir, pkg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `${SCOPE}${pkg.name}`,
        version: pkg.version ?? '9.9.9',
        type: 'module',
        ...(pkg.endora === undefined ? {} : { endora: pkg.endora }),
        exports:
          pkg.exports === undefined
            ? { '.': { default: './manifest.js' } }
            : pkg.exports,
        ...(pkg.peerDependencies === undefined
          ? {}
          : { peerDependencies: pkg.peerDependencies }),
        ...(pkg.peerDependenciesMeta === undefined
          ? {}
          : { peerDependenciesMeta: pkg.peerDependenciesMeta }),
        ...(pkg.dependencies === undefined ? {} : { dependencies: pkg.dependencies }),
        ...(pkg.devDependencies === undefined ? {} : { devDependencies: pkg.devDependencies }),
      }),
      'utf8',
    );
    if (pkg.rootSource !== undefined) {
      writeFileSync(join(dir, 'manifest.js'), pkg.rootSource, 'utf8');
    } else if (pkg.manifest !== undefined) {
      writeFileSync(
        join(dir, 'manifest.js'),
        `export const manifest = ${JSON.stringify(pkg.manifest)};\n`,
        'utf8',
      );
    } else {
      writeFileSync(join(dir, 'manifest.js'), 'export {};\n', 'utf8');
    }
    for (const [path, content] of Object.entries(pkg.files ?? {})) {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
    }
  }
  return root;
}

/** A platform package with no module of its own, and its four peers declared. */
const PLATFORM: FixturePackage = {
  name: 'platform',
  version: '1.2.3',
  endora: { type: 'platform' },
  peerDependencies: {
    '@mikro-orm/core': '^6',
    '@mikro-orm/postgresql': '^6',
    fastify: '^5',
    zod: '^4',
  },
  dependencies: { ioredis: '^5.10.1' },
};

/**
 * One module package in a fixture install.
 *
 * `version` is a parameter rather than the shared default because a fixture in
 * which every package sits at one version cannot express the case that broke:
 * a release moves packages at different rates, and a range built from another
 * package's version is invisible until a real registry is asked for it.
 */
function modulePackage(
  id: string,
  manifest: Record<string, unknown> = {},
  version?: string,
): FixturePackage {
  return {
    name: `mod-${id}`,
    endora: { type: 'module', id },
    manifest: { id, ...manifest },
    ...(version === undefined ? {} : { version }),
  };
}

function candidate(
  id: string,
  overrides: Partial<ModuleCandidate> = {},
): ModuleCandidate {
  return {
    id,
    packageName: `${SCOPE}mod-${id}`,
    version: '1.0.0',
    dependencies: [],
    acknowledged: [],
    required: false,
    reason: undefined,
    carriedByHost: false,
    env: [],
    ...overrides,
  };
}

function candidates(...entries: readonly ModuleCandidate[]): Map<string, ModuleCandidate> {
  return new Map(entries.map((entry) => [entry.id, entry] as const));
}

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: undefined,
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    // §2.4a's member, written: the ranges are the CLI's own optional peers,
    // which is where `docsRangesOf` reads them from.
    docsRanges: new Map([
      ['@docusaurus/core', '^3.10.0'],
      ['@docusaurus/preset-classic', '^3.10.0'],
    ]),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['@mikro-orm/postgresql', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['ioredis', '^5.10.1'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    // The default, and the one D-230 kept. A fixture that named the other would
    // be asserting the three-host examples everywhere they are not the subject.
    topology: 'single-host',
    // G3 — an instance with no declared runtime input is a real state (a
    // platform older than feature 117 declares none), and it is the fixture
    // that keeps every case below about its own subject. The cases that are
    // about the declaration hand one in.
    declared: [],
    existingEnv: '',
    generated: new Map(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T133 — the eight refusal classes, each with its exit code and its sentence
// ---------------------------------------------------------------------------

describe('the refusals (instance-tree.md §4)', () => {
  it('F1 — the target directory exists and is not empty', async () => {
    const root = installFixture([PLATFORM]);
    const target = join(root, 'occupied');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'README.md'), 'mine', 'utf8');

    const error = await runNewInstance({ dir: target, cwd: root }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstanceInputError);
    expect((error as InstanceInputError).refusal).toBe('F1');
    expect((error as Error).message).toContain('exists and is not empty');
    // The remedy, which `cli-surface.md` §2 requires of every refusal.
    expect((error as Error).message).toContain('Scaffold into an empty directory');
  });

  it('F1 — a directory holding nothing but a `.env` is the one exception', async () => {
    const root = installFixture([
      PLATFORM,
      modulePackage('settings', {
        activation: { nonDeactivatable: true, reason: 'nothing runs without settings' },
      }),
    ]);
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'DEPLOYMENT=acme\n', 'utf8');

    const result = await runNewInstance({ dir: target, cwd: root, dryRun: true });
    expect(result.plan.files.length).toBeGreaterThan(0);
  });

  it('F1 — there is no default target (R5.1)', async () => {
    const error = await runNewInstance({ cwd: tempRoot() }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstanceInputError);
    expect((error as InstanceInputError).refusal).toBe('F1');
    expect((error as Error).message).toContain('has no default');
  });

  it('F2 — a module set that cannot compose: a required module is missing', () => {
    const set = candidates(
      candidate('settings', { required: true, reason: 'the platform cannot start without it' }),
      candidate('blog'),
    );
    let thrown: unknown;
    try {
      resolveModuleSet(['blog'], set);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstanceInputError);
    expect((thrown as InstanceInputError).refusal).toBe('F2');
    // The platform's own sentence, and the remedy this command adds (§3.3).
    expect((thrown as Error).message).toContain('the platform cannot start without it');
    expect((thrown as Error).message).toContain('remedy: --module settings');
  });

  it('F2 — a module set that cannot compose: a dependency nothing satisfies', () => {
    const set = candidates(candidate('blog', { dependencies: ['cms'] }));
    let thrown: unknown;
    try {
      resolveModuleSet(['blog'], set);
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as InstanceInputError).refusal).toBe('F2');
    expect((thrown as Error).message).toContain('blog declares a dependency on cms');
    expect((thrown as Error).message).toContain('install it beside the target directory');
  });

  /**
   * The edge that binds and cannot be spelled `dependencies`, and the boot that
   * refuses without it.
   *
   * `acknowledgedDependencies` withdraws an install **ordering** claim and
   * nothing else — `carts` names `promotions` there only because
   * `promotion_usages_order_fk` obliges `promotions` to declare `orders` while
   * `carts` declares `orders` too, so `dependencies` would close a cycle. The
   * platform makes no such distinction when it decides presence:
   * `assertLockedModulesPresent` walks `dependencies` **and**
   * `acknowledgedDependencies`, and a module named in either that this
   * deployment does not ship is `ReducedDeploymentError` — the boot never
   * listens.
   *
   * So a set this command derives without following those edges is a set the
   * platform refuses. MEASURED, 2026-09-14, on the instance acceptance
   * criterion with a registry install's discovery shape:
   *
   *     ReducedDeploymentError: This deployment will not boot: it composes
   *     modules whose declarations it does not satisfy.
   *       promotions — not shipped by this deployment, and it is needed:
   *           carts — acknowledgedDependencies, port `promotionService`
   *           carts — acknowledgedDependencies, port `promotionCodePort`
   *
   * A4 and A15 are one failure of this, not two: `pnpm run start` and the
   * instance's own `admin:create` both compose, so both die in
   * `loadModulePresence`.
   */
  it('closes the set over `acknowledgedDependencies`, which bind exactly as `dependencies` do', () => {
    const set = candidates(
      candidate('carts', { acknowledged: ['promotions'] }),
      candidate('promotions'),
    );
    expect(resolveModuleSet(['carts'], set).ids).toEqual(['carts', 'promotions']);
  });

  it('F2 — an acknowledged edge nothing satisfies refuses, and says which kind it is', () => {
    const set = candidates(candidate('carts', { acknowledged: ['promotions'] }));
    let thrown: unknown;
    try {
      resolveModuleSet(['carts'], set);
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as InstanceInputError).refusal).toBe('F2');
    expect((thrown as Error).message).toContain('carts declares a dependency on promotions');
  });

  it('F2 — un-locking the required module changes the refusal in the same run', () => {
    // D-100: the required set is derived on every run and appears in no source
    // file. The same call with `required: false` composes.
    const unlocked = candidates(candidate('settings'), candidate('blog'));
    expect(resolveModuleSet(['blog'], unlocked).ids).toEqual(['blog']);
  });

  it('F3 — `--module` names an id no resolvable package declares', () => {
    let thrown: unknown;
    try {
      resolveModuleSet(['not-a-module'], candidates(candidate('blog')));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstanceInputError);
    expect((thrown as InstanceInputError).refusal).toBe('F3');
    expect((thrown as Error).message).toContain('not-a-module');
    expect((thrown as Error).message).toContain('install the one you meant');
  });

  it('F4 — `--deployment` is not a valid deployment name', async () => {
    const root = installFixture([PLATFORM]);
    const error = await runNewInstance({
      dir: join(root, 'acme-shop'),
      deployment: '../escape',
      cwd: root,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstanceInputError);
    expect((error as InstanceInputError).refusal).toBe('F4');
    expect((error as Error).message).toContain('is not a deployment name');
    expect((error as Error).message).toContain('DEPLOYMENT');
  });

  it('F5 — `--registry` is not a URL, and it is exit 2 rather than 1', async () => {
    const root = installFixture([PLATFORM]);
    const error = await runNewInstance({
      dir: join(root, 'acme-shop'),
      registry: 'not-a-url',
      cwd: root,
    }).catch((e: unknown) => e);
    // The class is what the exit code is read off, and `instance-tree.md` §4
    // puts a registry this run could not read among the inputs it could not
    // read — not among the refusals the operator can act on.
    expect(error).toBeInstanceOf(InstanceHostError);
    expect((error as InstanceHostError).refusal).toBe('F5');
    expect((error as Error).message).toContain('is not an absolute URL');
  });

  it('F6 — the platform version cannot be resolved, so no range can be written', async () => {
    // A fixture with module packages and no platform. Two things have no source
    // without it — the platform entry's own range, and the manifests the module
    // set is closed over — and neither may be reported as an empty module set.
    // A module package's *own* range is not among them: that comes off the
    // module package, which this fixture does have.
    const root = installFixture([modulePackage('blog')]);
    const error = await runNewInstance({ dir: join(root, 'acme-shop'), cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InstanceHostError);
    expect((error as InstanceHostError).refusal).toBe('F6');
    expect((error as Error).message).toContain(`${SCOPE}platform`);
    expect((error as Error).message).toContain('does not resolve');
    // It names where it looked, so the operator can see the search it lost.
    expect((error as Error).message).toContain('node_modules');
  });

  it('F7 — a resolved package whose manifest cannot be read', async () => {
    const root = installFixture([
      PLATFORM,
      {
        name: 'mod-broken',
        endora: { type: 'module', id: 'broken' },
        rootSource: 'this is not valid JavaScript ===\n',
      },
    ]);
    const error = await runNewInstance({ dir: join(root, 'acme-shop'), cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InstanceHostError);
    expect((error as InstanceHostError).refusal).toBe('F7');
    expect((error as Error).message).toContain(`${SCOPE}mod-broken`);
    // Never a skip: the message says what a skip would have cost.
    expect((error as Error).message).toContain('short by whatever that module needs');
  });

  it('F7 — a module package that publishes no root export', async () => {
    const root = installFixture([
      PLATFORM,
      {
        name: 'mod-unreachable',
        endora: { type: 'module', id: 'unreachable' },
        exports: { './package.json': './package.json' },
      },
    ]);
    const error = await runNewInstance({ dir: join(root, 'acme-shop'), cwd: root }).catch(
      (e: unknown) => e,
    );
    expect((error as InstanceHostError).refusal).toBe('F7');
    expect((error as Error).message).toContain('publishes no root export');
  });

  it('F8 — the CLI cannot determine its own version', async () => {
    const root = installFixture([PLATFORM]);
    // A module URL with no `package.json` above it anywhere: the state an
    // author is tempted to default, and the one R2.5 names in full.
    const error = await runNewInstance({
      dir: join(root, 'acme-shop'),
      cwd: root,
      moduleUrl: 'file:///nonexistent-root-for-f8/dist/new-instance/index.js',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InstanceHostError);
    expect((error as InstanceHostError).refusal).toBe('F8');
    expect((error as Error).message).toContain('cannot determine its own version');
  });

  it('every F1…F4 is exit 1 and every F5…F8 is exit 2, by class', () => {
    // The mapping the argv layer reads. Asserted as a property of the two
    // classes so that a ninth refusal joins a code by which class it is, never
    // by an entry somebody adds to a switch.
    expect(new InstanceInputError('F2', 'x')).toBeInstanceOf(InstanceInputError);
    expect(new InstanceHostError('F6', 'x')).toBeInstanceOf(InstanceHostError);
    expect(new InstanceHostError('F6', 'x')).not.toBeInstanceOf(InstanceInputError);
  });
});

// ---------------------------------------------------------------------------
// T132 — R5.1…R5.5
// ---------------------------------------------------------------------------

describe('the module set (§3)', () => {
  it('§3.2 — with no `--module` it writes the modules the platform requires, closed', () => {
    const set = candidates(
      candidate('settings', { required: true, reason: 'required' }),
      candidate('auth', { required: true, reason: 'required', dependencies: ['settings'] }),
      candidate('audit_logs', { dependencies: [] }),
      candidate('blog', { dependencies: ['cms'] }),
      candidate('cms'),
    );
    const resolution = resolveModuleSet([], set);
    expect(resolution.defaulted).toBe(true);
    expect(resolution.ids).toEqual(['auth', 'settings']);
    expect(resolution.ids).not.toContain('blog');
  });

  it('§3.1 — a named set is unioned with its own closure', () => {
    const set = candidates(
      candidate('blog', { dependencies: ['cms', 'assets_library'] }),
      candidate('cms', { dependencies: ['assets_library'] }),
      candidate('assets_library'),
    );
    const resolution = resolveModuleSet(['blog'], set);
    expect(resolution.ids).toEqual(['assets_library', 'blog', 'cms']);
    expect(resolution.requested).toEqual(['blog']);
    expect(resolution.closure).toEqual(['assets_library', 'cms']);
    expect(resolution.defaulted).toBe(false);
  });

  it('the set is sorted, so two runs of one command write one manifest', () => {
    const set = candidates(candidate('zeta'), candidate('alpha'));
    expect(resolveModuleSet(['zeta', 'alpha'], set).ids).toEqual(
      resolveModuleSet(['alpha', 'zeta'], set).ids,
    );
  });
});

describe('the tree (§1, §2)', () => {
  it('R1.1/R1.2 — every file the plan writes carries one of the three kinds', () => {
    const plan = planInstance(planInput());
    for (const file of plan.files) {
      expect(['client', 'wiring', 'derived']).toContain(file.kind);
    }
  });

  it('R5.4 — the module set appears exactly once in the written tree', () => {
    const plan = planInstance(
      planInput({
        modules: [
          { id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.7.1' },
          { id: 'blog', packageName: `${SCOPE}mod-blog`, version: '0.8.0' },
        ],
      }),
    );
    const naming = plan.files.filter((file) => file.content.includes(`${SCOPE}mod-blog`));
    expect(naming.map((file) => file.path)).toEqual(['package.json']);
  });

  /**
   * S5 — CLI 0.15.0 rendered `backend/src/worker.ts` with a `shutdown(signal)`
   * that never read `signal`, so a client's first lint of the tree they own
   * reported a defect in a file they did not write. Asked of every rendered
   * TypeScript wiring file rather than of that one, through the compiler's own
   * unused-binding diagnostics: a regex over parameter lists would be a second,
   * weaker parser of the same text.
   */
  it('R1.4 — no rendered wiring file declares a binding it never reads', () => {
    const plan = planInstance(planInput());
    const sources = plan.files.filter((file) => file.kind === 'wiring' && file.path.endsWith('.ts'));
    expect(sources.map((file) => file.path)).toContain('backend/src/worker.ts');
    const texts = new Map<string, string>(
      sources.map((file) => [`/instance/${file.path}`, file.content]),
    );
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noResolve: true,
      noLib: true,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    host.getSourceFile = (name, version) => {
      const text = texts.get(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, version, true);
    };
    host.fileExists = (name) => texts.has(name);
    host.readFile = (name) => texts.get(name);
    const program = ts.createProgram([...texts.keys()], options, host);
    // 6133: declared but never read; 6192/6196/6198/6205: the unused-import and
    // unused-destructuring variants of it.
    const unused = new Set([6133, 6192, 6196, 6198, 6205]);
    const found = [...texts.keys()].flatMap((name) =>
      program
        .getSemanticDiagnostics(program.getSourceFile(name))
        .filter((diagnostic) => unused.has(diagnostic.code))
        .map(
          (diagnostic) =>
            `${name.slice('/instance/'.length)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
        ),
    );
    expect(found).toEqual([]);
  });

  it('R1.5 — no file names anything above the instance directory', () => {
    const plan = planInstance(planInput());
    // Resolved rather than pattern-matched: `../mikro-orm.config.js` from
    // `backend/src/module-commands/` is a reference *within* the instance and
    // is correct, while the same three characters one directory up would leave
    // the tree. A regex over `../` cannot tell them apart and would have to be
    // either wrong or disabled.
    for (const file of plan.files) {
      for (const match of file.content.matchAll(/from '([^']+)'|@source '([^']+)'/g)) {
        const specifier = match[1] ?? match[2]!;
        if (!specifier.startsWith('.')) continue;
        const resolved = join('/instance', dirname(file.path), specifier);
        expect(resolved.startsWith('/instance/')).toBe(true);
      }
      expect(file.content).not.toContain('workspace:');
      // R1.5's other two halves: no `extends` above the tree, and no range that
      // only resolves inside a workspace.
      expect(file.content).not.toMatch(/"extends":\s*"\.\./);
    }
  });

  it('R3.3 — the instance generates none of the four backend registries', () => {
    const plan = planInstance(planInput());
    for (const registry of [
      'composition.generated',
      'manifest-index.generated',
      'entities-registry.generated',
      'migrations-registry.generated',
    ]) {
      expect(plan.files.some((file) => file.path.includes(registry))).toBe(false);
    }
  });

  /**
   * §2.6 and `instance-repository.md` R3.2 — and the count is **three**.
   *
   * This case read *"both generated artefacts"* and asserted two while R3.2
   * already said three: `admin/src/tailwind.generated.css` arrived with T124 on
   * the day this command landed, so the assertion recorded the stale number
   * rather than catching it. A committed stylesheet enumeration is the tree and
   * the install disagreeing about which packages Tailwind scanned, which is
   * silent in exactly the direction `admin-stylesheet-composition.md` exists
   * for. Derived from the constant rather than listed here, so a fourth
   * artefact is covered by existing.
   */
  it('§2.6 — every generated artefact is git-ignored', () => {
    const plan = planInstance(planInput());
    const ignore = plan.files.find((file) => file.path === '.gitignore')!;
    expect(GENERATED_ARTEFACTS.length).toBeGreaterThanOrEqual(3);
    for (const artefact of GENERATED_ARTEFACTS) expect(ignore.content).toContain(artefact);
    expect(ignore.content).toContain('admin/src/tailwind.generated.css');
  });

  it('D-216 — no demo artefact is written, at any tier', () => {
    const plan = planInstance(planInput());
    for (const file of plan.files) {
      expect(file.path).not.toMatch(/demo/i);
      // The capability is discoverable through the next-steps block; a *file*
      // naming it in a tree the client owns is what the ruling forbids.
      expect(file.content).not.toMatch(/demo:seed|demo seed|seedDemo/);
    }
  });

  /**
   * `specs/110-instance-repository/` T141 — every root script reaches the member.
   *
   * The red proof is the acceptance criterion's first end-to-end run: these read
   * `pnpm --filter backend run …` while the member is named `<name>-backend`, so
   * pnpm matched no project, printed `No projects matched the filters` and
   * **exited 0**. `migrate`, `build`, `start`, `dev` and the five `module:*`
   * commands were all silent no-ops, and so was every step of the next-steps
   * block the command prints to a client.
   */
  it('T141 — no root script filters on a project name that is not the member\'s', () => {
    const plan = planInstance(planInput({ name: 'acme-shop' }));
    const root = JSON.parse(
      plan.files.find((file) => file.path === 'package.json')!.content,
    ) as { scripts: Record<string, string> };
    const member = JSON.parse(
      plan.files.find((file) => file.path === 'backend/package.json')!.content,
    ) as { name: string; scripts: Record<string, string> };

    expect(Object.keys(root.scripts).length).toBeGreaterThan(0);
    let delegations = 0;
    for (const [name, command] of Object.entries(root.scripts)) {
      expect(command).not.toContain('--filter');
      // A script that delegates must reach a member that is **in the plan**,
      // and the member script the delegation actually names. The member is read
      // out of the `-C <dir>` token rather than assumed to be the backend, so
      // the admin and documentation members are covered by the same assertion
      // and a third member would be too.
      //
      // The **delegated** name, not the root one: they agreed by coincidence
      // until feature 122 named the per-layer builds, and `build:backend →
      // pnpm -C backend run build` is the first pair where they differ. What
      // T141's red proof was about is a delegation reaching nothing, and that
      // is what the `-C` token and the script token together answer.
      for (const [, directory, delegated] of command.matchAll(/pnpm -C (\S+) run (\S+)/g)) {
        delegations += 1;
        const manifest = plan.files.find((file) => file.path === `${directory}/package.json`);
        expect(manifest, `${name} delegates to ${directory}, which the plan does not write`)
          .toBeDefined();
        const scripts = (JSON.parse(manifest!.content) as { scripts: Record<string, string> })
          .scripts;
        expect(
          scripts[delegated!],
          `${name} delegates to \`${delegated!}\` in ${directory}, which declares no such script`,
        ).toBeDefined();
      }
    }
    expect(delegations).toBeGreaterThan(0);
    // `generate` is the one root script that is not a delegation: one
    // `endora generate` renders every member's artefacts, so there is no member
    // to forward to. The binary has to be on the root's own path.
    expect(root.scripts['generate']).toBe('endora generate');
    const rootManifest = JSON.parse(
      plan.files.find((file) => file.path === 'package.json')!.content,
    ) as { devDependencies: Record<string, string> };
    expect(rootManifest.devDependencies[`${SCOPE}cli`]).toBeDefined();
    expect(member.name).toBe('acme-shop-backend');
  });

  it('T141 — the next steps name the build and the module install, in order', () => {
    // A client who follows this block gets a running instance; before T141 it
    // named neither, so `start` ran a `dist` nothing had built and the boot
    // refused over every module whose registry row `module:install` writes.
    //
    // **The four middle steps are now one line and the property is unchanged**
    // (`specs/125-first-mile-install/` FR-109, T1-H). `setup` IS
    // `generate && build && migrate && module:install --all` — derived from
    // those named entries, so the order T141 was written about is inside the
    // script's own value and is asserted there, in
    // `test/new-instance/first-mile-scripts.test.ts`. What this case keeps is
    // the part that is about the block: every one of the four is still named
    // where a client reads it, and the whole of it still comes before `start`.
    const steps = nextSteps('/tmp/acme', 'default');
    const text = steps.join('\n');
    const setup = steps.findIndex((s) => s.startsWith('pnpm run setup'));
    expect(setup).toBeGreaterThanOrEqual(0);
    for (const named of ['generate', 'build', 'migrate', 'module:install --all']) {
      expect(steps[setup], `the setup step no longer names \`${named}\``).toContain(named);
    }
    expect(setup).toBeLessThan(steps.findIndex((s) => s.startsWith('pnpm run start')));
    // The services come before the schema does, which is the step this
    // sequence gained: `migrate` against a database nobody started is the
    // failure the first three steps of the old sequence were spent avoiding by
    // hand.
    expect(steps.findIndex((s) => s.startsWith('pnpm run dev:services'))).toBeLessThan(setup);
    // R3.4's own line, and the one the block has always ended on.
    expect(text).toContain('endora new storefront <dir>');
  });

  /**
   * Feature 122 T017 — the block gains one line under `three-host`, and gains
   * it **only** there.
   *
   * A client who scaffolded three hosts has three directories of examples and
   * no reason to look in any of them; a client who scaffolded one would be told
   * about files their tree does not hold.
   */
  it('T017 — the three-host line is printed for that topology and for no other', () => {
    const single = nextSteps('/tmp/acme', 'default').join('\n');
    const three = nextSteps('/tmp/acme', 'default', 'three-host').join('\n');
    expect(single).not.toContain('three-host');
    expect(three).toContain('deploy/three-host/');
    expect(three).toContain('not interchangeable');
    // It is one line added to the same block, in the same place: everything the
    // single-host run prints is still printed, and still first.
    expect(nextSteps('/tmp/acme', 'default', 'three-host').length).toBe(
      nextSteps('/tmp/acme', 'default').length + 1,
    );
    expect(three.indexOf('deploy/three-host/')).toBeLessThan(
      three.indexOf('endora new storefront <dir>'),
    );
  });

  it('R1.4 — the wiring is under the bound, measured on the plan', () => {
    expect(wiringLineCount(planInstance(planInput()))).toBeLessThan(250);
  });

  /**
   * R1.4 again, over the plan a **complete** `--registry` run writes — which is
   * a different plan from the one above, and was measured by nothing.
   *
   * Two populations the case above leaves out, and each one alone is inside the
   * headroom it had. `planInput()` resolves no admin shell, so its plan omits
   * the `admin/` member and the ten-line `admin/src/main.tsx` with it and
   * writes `pnpm-workspace.yaml` one line shorter; and its `npmrc` is `null`,
   * so the eleven-line `.npmrc` — `kind: 'wiring'` — is not in the count
   * either. 237 lines over twelve files, against a real run's 248 over thirteen
   * and 259 over fourteen.
   *
   * The criterion measures the created tree rather than this plan, and it read
   * exactly those two numbers: A14 passed at 248 in `tarball` mode and failed
   * at **259** in `registry` mode on pipeline 13835, from one checkout on one
   * day. A bound a supply route decides is not a bound on the wiring a client
   * maintains, and a fixture that is short of the plan every real run writes is
   * how a green here and a red there came from one tree.
   */
  it('R1.4 — the bound holds for the complete plan, admin member and `.npmrc` included', () => {
    const registry = 'https://registry.example.com/';
    const npmrc = npmrcContent(registry, ['@endora-commerce']);
    const complete = planInstance(
      planInput({
        adminShellVersion: '4.5.6',
        adminKitVersion: '4.5.6',
        adminRanges: new Map([
          ['react', '^19.0.0'],
          ['react-dom', '^19.0.0'],
          ['vite', '^7.3.2'],
          ['@vitejs/plugin-react', '^5.2.0'],
          ['tailwindcss', '^4.2.4'],
          ['@tailwindcss/vite', '^4.2.4'],
        ]),
        adminPeers: new Map(),
        registry,
        npmrc,
      }),
    );
    // Both members are really in it, so the assertion below is over the whole
    // population rather than over a plan that quietly omitted one again.
    expect(complete.files.some((file) => file.path === 'admin/src/main.tsx')).toBe(true);
    expect(complete.files.some((file) => file.path === '.npmrc')).toBe(true);
    expect(wiringLineCount(complete)).toBeLessThan(250);
  });

  /**
   * G2 (`specs/123-oss-install-experience/`) — the omission that left a
   * scaffolded instance unable to create an administrator.
   *
   * `template.ts` carried an explicit `omitted.push` for `backend/src/cli.ts`
   * whose reason was *"the demo layer around it is exported under no subpath"*.
   * The consequence was measured, not theoretical: no `admin_users create`, so
   * nobody could log in to the admin bundle A5 and A13 prove is built and
   * styled.
   */
  describe('G2 — the instance runs the commands its modules declare', () => {
    const withAdminUsers = (): PlanInput =>
      planInput({
        modules: [
          { id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' },
          { id: 'admin_users', packageName: `${SCOPE}mod-admin-users`, version: '0.4.5' },
        ],
      });

    it('writes the entry point, and stops reporting it as an omission', () => {
      const plan = planInstance(planInput());
      const cli = plan.files.find((file) => file.path === 'backend/src/cli.ts');
      expect(cli, 'a scaffolded instance still has no CLI entry point').toBeDefined();
      expect(cli!.kind).toBe('wiring');
      // An omission whose reason has been discharged must not survive as prose.
      expect(plan.omitted.map((entry) => entry.path)).not.toContain('backend/src/cli.ts');
    });

    it('D-207 — it calls the dispatcher and holds no copy of it', () => {
      const cli = planInstance(planInput()).files.find(
        (file) => file.path === 'backend/src/cli.ts',
      )!;
      expect(cli.content).toContain(`from '${SCOPE}platform/cli'`);
      expect(cli.content).toContain('runCli(');
      // A copy would have to name these. An instance takes the platform as a
      // dependency and receives none of the host's sources.
      for (const copied of [
        'collectModuleCommands',
        'enterSystemScope',
        'mustBeNonProduction',
        'formatDemoReport',
      ]) {
        expect(cli.content, `the instance holds a copy of ${copied}`).not.toContain(copied);
      }
    });

    it('T2-D — the backend member addresses any declared command', () => {
      const scripts = (
        JSON.parse(
          planInstance(planInput()).files.find((file) => file.path === 'backend/package.json')!
            .content,
        ) as { scripts: Record<string, string> }
      ).scripts;
      // The generic pass-through: a module the instance installed which declares
      // a `cliCommands` entry is addressable with no file in the tree edited.
      expect(scripts['cli']).toBe('node --env-file-if-exists=../.env dist/cli.js');
      // D-216 is more specific than T2-D, which asked for `demo:seed` and
      // `demo:reset` here: *"no composition, **no script**, no example and no
      // placeholder"*. `cli` reaches both verbs, so nothing is unavailable.
      expect(scripts['demo:seed']).toBeUndefined();
      expect(scripts['demo:reset']).toBeUndefined();
    });

    it('T2-D — the named aliases are derived from the module set, not written', () => {
      const scriptsOf = (input: PlanInput): Record<string, string> =>
        (
          JSON.parse(
            planInstance(input).files.find((file) => file.path === 'backend/package.json')!
              .content,
          ) as { scripts: Record<string, string> }
        ).scripts;
      expect(scriptsOf(withAdminUsers())['admin:create']).toBe(
        'node --env-file-if-exists=../.env dist/cli.js admin_users create',
      );
      // The default input installs `settings` alone, so the alias would address
      // a command no installed module declares.
      expect(scriptsOf(planInput())['admin:create']).toBeUndefined();
      expect(scriptsOf(planInput())['cli']).toBeDefined();
    });

    it('T2-D — the root forwards each of them with `-C`', () => {
      const root = (
        JSON.parse(
          planInstance(withAdminUsers()).files.find((file) => file.path === 'package.json')!
            .content,
        ) as { scripts: Record<string, string> }
      ).scripts;
      expect(root['cli']).toBe('pnpm -C backend run cli');
      expect(root['admin:create']).toBe('pnpm -C backend run admin:create');
    });

    it('T2-E — the next steps name the administrator, after the module install', () => {
      const steps = nextSteps('/tmp/acme', 'default', DEFAULT_TOPOLOGY, ['settings', 'admin_users']);
      const text = steps.join('\n');
      expect(text).toContain('admin:create');
      expect(
        steps.findIndex((step) => step.includes('module:install')),
      ).toBeLessThan(steps.findIndex((step) => step.includes('admin:create')));
    });

    it('T2-E — the demo step the docstring already claimed is there', () => {
      // The docstring above `nextSteps()` said *"The demo step is here rather
      // than in the tree"* while the array had none. Opt-in by the owner's
      // ruling of 2026-09-06, so the step says so rather than running it.
      const steps = nextSteps('/tmp/acme', 'default', DEFAULT_TOPOLOGY, ['settings', 'admin_users']);
      expect(steps.join('\n')).toContain('cli demo seed');
      expect(steps.join('\n')).toContain('cli demo reset');
    });

    it('T2-E — an instance with no `admin_users` is told nothing it cannot run', () => {
      expect(nextSteps('/tmp/acme', 'default', DEFAULT_TOPOLOGY, ['settings']).join('\n')).not.toContain(
        'admin:create',
      );
    });
  });

  it('§2.2 — the divergence declaration is written out in full, with its doc block', () => {
    const plan = planInstance(planInput({ deployment: 'acme' }));
    const declaration = plan.files.find((f) => f.path === 'apps/acme/divergence.ts')!;
    expect(declaration.content).toContain('omittedModules: []');
    expect(declaration.content).toContain('decorationOrder: {}');
    expect(declaration.content).toContain('reasons: {}');
    // The doc block is the point: a field an author never sees is a field they
    // never learn they have.
    expect(declaration.content).toContain('/**');
    expect(declaration.content).toContain('decorate one');
  });

  it('R2.5a — a range with no declared source is left out rather than invented', () => {
    const withoutTypescript = planInput({
      declaredRanges: new Map([['@mikro-orm/core', '^6']]),
    });
    const written = devDependenciesFor(withoutTypescript).map(([name]) => name);
    expect(written).toContain('@mikro-orm/core');
    expect(written).toContain('@mikro-orm/migrations');
    expect(written).not.toContain('typescript');
    expect(written).not.toContain('zod');
  });

  it('R2.5a — the four peer ranges are the platform\'s own, not this command\'s', () => {
    const plan = planInstance(
      planInput({ declaredRanges: new Map([['zod', '^99-from-the-platform']]) }),
    );
    const manifest = JSON.parse(
      plan.files.find((f) => f.path === 'package.json')!.content,
    ) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies['zod']).toBe('^99-from-the-platform');
  });

  /**
   * **A release is not uniform, and the ranges have to survive that.**
   *
   * The three packages below sit at three versions on purpose: that is the case
   * the fixture could not express while `PlanInput.modules` carried no version
   * of its own, and while it could not, the site that writes the entries had
   * exactly one version in scope — the platform's — and wrote it onto every
   * module. Measured on the real release of 2026-09-11: 68 packages at `0.8.0`,
   * 15 at `0.7.1`, and `ERR_PNPM_NO_MATCHING_VERSION  No matching version found
   * for @endora-commerce/mod-addresses@^0.8.0` at the first install of a
   * scaffolded instance.
   *
   * Equal versions would assert nothing here: every wrong answer agrees with
   * the right one.
   */
  it('R2.3 — each package is ranged at its own version, not at the platform\'s', () => {
    const plan = planInstance(
      planInput({
        platformVersion: '0.8.0',
        modules: [
          { id: 'addresses', packageName: `${SCOPE}mod-addresses`, version: '0.7.1' },
          { id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.8.0' },
        ],
      }),
    );
    const manifest = JSON.parse(
      plan.files.find((f) => f.path === 'package.json')!.content,
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies[`${SCOPE}platform`]).toBe('^0.8.0');
    expect(manifest.dependencies[`${SCOPE}mod-addresses`]).toBe('^0.7.1');
    expect(manifest.dependencies[`${SCOPE}mod-settings`]).toBe('^0.8.0');
    // And the plan's own map, which is what `--dry-run` reports, agrees with the
    // file — two derivations of one set is how the report comes to describe a
    // manifest nobody has.
    expect(plan.dependencies.get(`${SCOPE}mod-addresses`)).toBe('^0.7.1');
  });

  it('R5.7 — no `.npmrc` without `--registry`, and never a token', () => {
    expect(planInstance(planInput()).files.some((f) => f.path === '.npmrc')).toBe(false);
    const withRegistry = planInstance(
      planInput({
        registry: 'https://registry.example.com/',
        npmrc: '@endora-commerce:registry=https://registry.example.com/\n',
      }),
    );
    const npmrc = withRegistry.files.find((f) => f.path === '.npmrc')!;
    expect(npmrc.content).not.toMatch(/_authToken=[^$]/);
  });

  it('§2.4 — the admin member is omitted, and the omission is not silent', () => {
    const plan = planInstance(planInput());
    expect(plan.files.some((file) => file.path.startsWith('admin/'))).toBe(false);
    const omission = plan.omitted.find((entry) => entry.path === 'admin/')!;
    expect(omission.reason).toContain('headless API');
  });
});

/**
 * §2.4 — the admin member, written (`specs/110-instance-repository/` T138).
 *
 * Every case below drives {@link planInstance} over a plan input whose admin
 * halves are present, which is what {@link runNewInstance} builds from the
 * packages it resolved: the shell's and the kit's versions, the ranges off the
 * shell's own manifest, and the optional peers of everything the instance
 * composes. A case that handed the member a pre-decided file list would be
 * asserting the fixture (issue #130).
 */
describe('the admin member (instance-tree.md §2.4)', () => {
  const withAdmin = (overrides: Partial<PlanInput> = {}): PlanInput =>
    planInput({
      adminShellVersion: '4.5.6',
      adminKitVersion: '4.5.6',
      adminRanges: new Map([
        ['react', '^19.0.0'],
        ['react-dom', '^19.0.0'],
        ['vite', '^7.3.2'],
        ['@vitejs/plugin-react', '^5.2.0'],
        ['tailwindcss', '^4.2.4'],
        ['@tailwindcss/vite', '^4.2.4'],
      ]),
      adminPeers: new Map([
        ['@measured/puck', '^0'],
        ['lucide-react', '^1'],
        ['vite', '^7.3.2'],
      ]),
      ...overrides,
    });

  it('writes the member, and no file outside it changes kind', () => {
    const plan = planInstance(withAdmin());
    const admin = plan.files.filter((file) => file.member === 'admin');
    expect(admin.map((file) => file.path).sort()).toEqual([
      'admin/index.html',
      'admin/package.json',
      'admin/src/index.css',
      'admin/src/main.tsx',
      'admin/tsconfig.json',
      'admin/vite.config.ts',
    ]);
    // R1.1: one file of this member is wiring and the rest are the client's or
    // derived. A member with no wiring at all would mean the registry reached
    // the shell by some route this bound does not see.
    expect(admin.filter((file) => file.kind === 'wiring').map((file) => file.path)).toEqual([
      'admin/src/main.tsx',
    ]);
    expect(plan.omitted.some((entry) => entry.path === 'admin/')).toBe(false);
    expect(plan.members).toContain('admin');
  });

  it('R1.4 — the wiring it adds keeps the whole plan under the bound', () => {
    expect(wiringLineCount(planInstance(withAdmin()))).toBeLessThan(250);
  });

  it('R5.4 — the workspace lists both members, and one when the admin is omitted', () => {
    const workspaceOf = (plan: ReturnType<typeof planInstance>): string =>
      plan.files.find((file) => file.path === 'pnpm-workspace.yaml')!.content;
    expect(workspaceOf(planInstance(withAdmin()))).toContain('  - admin');
    expect(workspaceOf(planInstance(planInput()))).not.toContain('  - admin');
  });

  /**
   * R3.6 — the module set appears exactly once, and it is the root's.
   *
   * The measured defect this guards is subtler than a duplicated list: pnpm
   * resolves a package's peers from its **dependent's** context, so declaring
   * the module set here is the obvious way to make a module's optional peers
   * resolve — and it is the one thing R3.6 forbids. The peers are declared
   * beside the modules instead, at the root.
   */
  it('R3.6 — the admin member declares no module package, and the root declares their peers', () => {
    const plan = planInstance(withAdmin());
    const admin = JSON.parse(
      plan.files.find((file) => file.path === 'admin/package.json')!.content,
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const declared = [...Object.keys(admin.dependencies), ...Object.keys(admin.devDependencies)];
    expect(declared.filter((name) => name.startsWith(`${SCOPE}mod-`))).toEqual([]);
    expect(declared).toContain(`${SCOPE}admin-shell`);
    expect(declared).toContain(`${SCOPE}admin-kit`);

    const root = JSON.parse(plan.files.find((file) => file.path === 'package.json')!.content) as {
      dependencies: Record<string, string>;
    };
    expect(root.dependencies['@measured/puck']).toBe('^0');
    expect(root.dependencies['lucide-react']).toBe('^1');
    // A build tool is the admin member's and never the root's: it builds the
    // bundle and is not in it.
    expect(root.dependencies['vite']).toBeUndefined();
    expect(admin.devDependencies['vite']).toBe('^7.3.2');
  });

  it('§2.5 — the root gains `generate`, and `build` reaches both members', () => {
    const scripts = (plan: ReturnType<typeof planInstance>): Record<string, string> =>
      (JSON.parse(plan.files.find((file) => file.path === 'package.json')!.content) as {
        scripts: Record<string, string>;
      }).scripts;
    const withMember = scripts(planInstance(withAdmin()));
    // One `endora generate` renders every member's artefacts — T137 gave the
    // documentation site a second pair, and two root scripts forwarding to two
    // members would be two spellings of one run.
    expect(withMember['generate']).toBe('endora generate');
    expect(withMember['build']).toContain('pnpm -C admin run build');
    // A tree with nothing to generate at all: no `generate`, rather than a
    // script that fails on a directory nobody wrote. One member absent is not
    // that state — the documentation site generates its own pair — and since
    // T065 **a module installed is not that state either**: the entity index
    // belongs to no member, so a headless instance with a module has an
    // artefact. The state that remains is a headless instance with no module.
    const without = scripts(
      planInstance(planInput({ docsRanges: new Map(), modules: [] })),
    );
    expect(without['generate']).toBeUndefined();
    expect(without['build']).toBe('pnpm -C backend run build');
    const headlessWithModules = scripts(planInstance(planInput({ docsRanges: new Map() })));
    expect(headlessWithModules['generate']).toBe('endora generate');
    const docsOnly = scripts(planInstance(planInput()));
    expect(docsOnly['generate']).toBe('endora generate');
    expect(docsOnly['build']).toBe('pnpm -C backend run build && pnpm -C docs run build');
  });

  it('the entry point mounts the shell over the generated registry, and nothing else', () => {
    const main = planInstance(withAdmin()).files.find(
      (file) => file.path === 'admin/src/main.tsx',
    )!;
    expect(main.content).toContain(`from '${SCOPE}admin-shell'`);
    expect(main.content).toContain("from './modules.generated.js'");
    // The service worker registers an asset this member does not ship, so a
    // call to it here would be a dead promise in a client's tree.
    expect(main.content).not.toContain('registerAdminServiceWorker');
  });

  it('the stylesheet imports the design system and the generated enumeration, in order', () => {
    const css = planInstance(withAdmin()).files.find(
      (file) => file.path === 'admin/src/index.css',
    )!.content;
    const order = ['@import "tailwindcss"', 'admin-kit/theme.css', './tailwind.generated.css'];
    let cursor = -1;
    for (const fragment of order) {
      const at = css.indexOf(fragment);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    // R2.3 — the override slot is last, so a redeclaration wins.
    expect(css.lastIndexOf('@import')).toBeLessThan(css.indexOf('Your overrides go here'));
  });

  it('the project is findable by the `"@/*"` alias its generator locates it through', () => {
    const tsconfig = JSON.parse(
      planInstance(withAdmin()).files.find((file) => file.path === 'admin/tsconfig.json')!.content,
    ) as { compilerOptions: { paths: Record<string, string[]> } };
    expect(tsconfig.compilerOptions.paths['@/*']).toEqual(['./src/*']);
  });

  it('§2.4 — one package absent omits the member and says which', () => {
    for (const [missing, overrides] of [
      [`${SCOPE}admin-shell`, { adminShellVersion: null }],
      [`${SCOPE}admin-kit`, { adminKitVersion: null }],
    ] as const) {
      const plan = planInstance(withAdmin(overrides));
      expect(plan.files.some((file) => file.member === 'admin')).toBe(false);
      const omission = plan.omitted.find((entry) => entry.path === 'admin/')!;
      expect(omission.reason).toContain(missing);
      expect(omission.reason).toContain('headless API');
    }
  });

  /**
   * R2.5a — a range with no source is not invented, here as everywhere.
   *
   * The remedy is the operator's and the sentence names the package, because
   * *"a value the tool invented is a value nobody reviewed"* is unactionable
   * unless the run says which value it would have had to invent.
   */
  it('§2.4 — a build-tool range with no source omits the member and names it', () => {
    const ranges = new Map(withAdmin().adminRanges);
    ranges.delete('@tailwindcss/vite');
    const plan = planInstance(withAdmin({ adminRanges: ranges }));
    expect(plan.files.some((file) => file.member === 'admin')).toBe(false);
    expect(plan.omitted.find((entry) => entry.path === 'admin/')!.reason).toContain(
      '@tailwindcss/vite',
    );
  });
});

describe('the command (R5.2, R5.3)', () => {
  // Three packages at three versions — the platform at `1.2.3` and the two
  // modules at a version each, because a fixture in which they agree cannot
  // tell a range built from the package it names from one built from the
  // platform's.
  const fixture = (): string =>
    installFixture([
      PLATFORM,
      modulePackage(
        'settings',
        { activation: { nonDeactivatable: true, reason: 'nothing runs without settings' } },
        '0.7.1',
      ),
      modulePackage('blog', { dependencies: ['settings'] }, '0.8.0'),
    ]);

  it('R5.3 — a dry run reports every file it would write, and writes nothing', async () => {
    const root = fixture();
    const target = join(root, 'acme-shop');
    const result = await runNewInstance({ dir: target, cwd: root, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.plan.files.length).toBeGreaterThan(0);
    const { existsSync } = await import('node:fs');
    expect(existsSync(target)).toBe(false);
  });

  it('R5.2 — a run that refuses has written nothing', async () => {
    const root = fixture();
    const target = join(root, 'acme-shop');
    await runNewInstance({ dir: target, cwd: root, modules: ['nope'] }).catch(() => undefined);
    const { existsSync } = await import('node:fs');
    expect(existsSync(target)).toBe(false);
  });

  it('it writes the tree, and the module list is the root manifest', async () => {
    const root = fixture();
    const target = join(root, 'acme-shop');
    const result = await runNewInstance({ dir: target, cwd: root, modules: ['blog'] });
    const { existsSync, readFileSync } = await import('node:fs');
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'backend/src/index.ts'))).toBe(true);
    expect(existsSync(join(target, 'apps/acme-shop/modules/.gitkeep'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      `${SCOPE}mod-blog`,
      `${SCOPE}mod-settings`,
      `${SCOPE}platform`,
    ]);
    // R2.3 — the range is the platform version being installed, not the CLI's.
    expect(manifest.dependencies[`${SCOPE}platform`]).toBe('^1.2.3');
    // …and a module's is **that module package's** own, read off the manifest of
    // the package installed beside the target directory. It was the platform's
    // until this was asserted, which a uniform fixture could not have shown and
    // the tarball acceptance mode cannot show at all: that mode overrides every
    // one of these ranges with a `file:` path, so the first thing that ever
    // resolves them is a client's install against a real registry.
    expect(manifest.dependencies[`${SCOPE}mod-settings`]).toBe('^0.7.1');
    expect(manifest.dependencies[`${SCOPE}mod-blog`]).toBe('^0.8.0');
    expect(result.modules.ids).toEqual(['blog', 'settings']);
  });

  it('R2.5a — a provenance line, on every run, with `defaulted=0`', async () => {
    const root = fixture();
    const result = await runNewInstance({
      dir: join(root, 'acme-shop'),
      cwd: root,
      dryRun: true,
    });
    expect(result.provenance).toContain('defaulted=0');
  });
});

// ---------------------------------------------------------------------------
// Feature 122 Phase 1 — the per-layer builds are named
// (`specs/122-layer-deployment-independence/contracts/layer-independence.md`
// §2 R2.1, under D-230)
// ---------------------------------------------------------------------------

/**
 * A layer is deployed alone, so it must be buildable alone — and a CI job on
 * the admin host cannot cite a command it was never told.
 *
 * The composite `build` keeps its present **value**; what changes is that its
 * parts are named. So the assertion on it is byte-identical to what the
 * command rendered before this feature, which is the half that stops a "name
 * the parts" change from quietly re-deciding what the whole does.
 */
describe('§2 R2.1 — each layer has a named build, and the composite is their conjunction', () => {
  const rootScripts = (input: PlanInput): Record<string, string> =>
    (
      JSON.parse(
        planInstance(input).files.find((file) => file.path === 'package.json')!.content,
      ) as { scripts: Record<string, string> }
    ).scripts;

  const withAdminMember = (overrides: Partial<PlanInput> = {}): PlanInput =>
    planInput({
      adminShellVersion: '4.5.6',
      adminKitVersion: '4.5.6',
      adminRanges: new Map([
        ['react', '^19.0.0'],
        ['react-dom', '^19.0.0'],
        ['vite', '^7.3.2'],
        ['@vitejs/plugin-react', '^5.2.0'],
        ['tailwindcss', '^4.2.4'],
        ['@tailwindcss/vite', '^4.2.4'],
      ]),
      adminPeers: new Map(),
      ...overrides,
    });

  it('declares `build:backend` always — the backend member is never omitted', () => {
    expect(rootScripts(planInput())['build:backend']).toBe('pnpm -C backend run build');
    expect(rootScripts(withAdminMember())['build:backend']).toBe('pnpm -C backend run build');
  });

  it('declares `build:admin` and `build:docs` exactly when those members are written', () => {
    const complete = rootScripts(withAdminMember());
    expect(complete['build:admin']).toBe('pnpm -C admin run build');
    expect(complete['build:docs']).toBe('pnpm -C docs run build');

    // The same two predicates the composite has always used, and no third one:
    // an admin-less instance gets no `build:admin`, rather than a script that
    // fails on a directory nobody wrote.
    const noAdmin = rootScripts(planInput());
    expect(noAdmin['build:admin']).toBeUndefined();
    expect(noAdmin['build:docs']).toBe('pnpm -C docs run build');

    const neither = rootScripts(withAdminMember({ docsRanges: new Map() }));
    expect(neither['build:docs']).toBeUndefined();
    expect(neither['build:admin']).toBe('pnpm -C admin run build');

    const backendOnly = rootScripts(planInput({ docsRanges: new Map() }));
    expect(backendOnly['build:admin']).toBeUndefined();
    expect(backendOnly['build:docs']).toBeUndefined();
  });

  it('the composite is the conjunction of the declared ones, in backend, admin, docs order', () => {
    for (const input of [
      planInput(),
      planInput({ docsRanges: new Map() }),
      withAdminMember(),
      withAdminMember({ docsRanges: new Map() }),
    ]) {
      const scripts = rootScripts(input);
      const parts = ['build:backend', 'build:admin', 'build:docs']
        .filter((name) => scripts[name] !== undefined)
        .map((name) => scripts[name]!);
      expect(scripts['build']).toBe(parts.join(' && '));
    }
    // …and the value is byte-identical to what this command rendered before the
    // parts were named. A "name the parts" change that re-decided what the
    // whole does would pass the derivation above and fail here.
    expect(rootScripts(withAdminMember())['build']).toBe(
      'pnpm -C backend run build && pnpm -C admin run build && pnpm -C docs run build',
    );
    expect(rootScripts(planInput())['build']).toBe(
      'pnpm -C backend run build && pnpm -C docs run build',
    );
    expect(rootScripts(planInput({ docsRanges: new Map() }))['build']).toBe(
      'pnpm -C backend run build',
    );
  });

  /**
   * T003 — the README a client reads names every command the manifest declares,
   * and no command it does not.
   *
   * Both sides are derived from the same run, so a script added to the root
   * manifest with no line in the README is red here rather than discovered by a
   * client who cannot find the command they were told to run.
   */
  it('T003 — the README names every root script, and no script the manifest lacks', () => {
    for (const input of [planInput(), withAdminMember(), planInput({ docsRanges: new Map() })]) {
      const plan = planInstance(input);
      const scripts = Object.keys(
        (
          JSON.parse(
            plan.files.find((file) => file.path === 'package.json')!.content,
          ) as { scripts: Record<string, string> }
        ).scripts,
      ).sort();
      const readmeText = plan.files.find((file) => file.path === 'README.md')!.content;
      const block = /```\npnpm install\n([\s\S]*?)```/.exec(readmeText);
      expect(block, 'the README still has one command block, and it is a block').not.toBeNull();
      const named = [...block![1]!.matchAll(/^pnpm run (\S+)/gm)].map((match) => match[1]!).sort();
      expect(named).toEqual(scripts);
    }
  });

  it('T003 — the block says why a layer may be built alone: it is deployed alone', () => {
    const readmeText = planInstance(withAdminMember()).files.find(
      (file) => file.path === 'README.md',
    )!.content;
    expect(readmeText).toContain('deployed on its own');
  });
});

// ---------------------------------------------------------------------------
// G3 — `.env.example` declares what the instance actually reads
// (`specs/123-oss-install-experience/` T3-A…T3-E; FR-010, FR-011; SC-005)
// ---------------------------------------------------------------------------

/**
 * The defect these cases were written red against, in the acceptance run's own
 * words: *"supplied `DATABASE_URL`, `REDIS_URL`, `SESSION_COOKIE_SECRET`,
 * `PUBLIC_API_BASE_URL`, `NODE_ENV` to the instance's own processes; its
 * `.env.example` declares none of them, so a client who fills in the file the
 * command wrote has nothing to put them in"*.
 *
 * Every case below asserts a **derivation** rather than a string: the file's
 * population is the platform's declaration unioned with the manifests of the
 * modules this run installed, so a different module set is a different file and
 * no list anywhere has to be edited for it (D-100).
 */
function declaredInput(
  name: string,
  overrides: Partial<EnvironmentInput> = {},
): EnvironmentInput {
  return {
    name,
    describes: { en: `what ${name} decides`, pl: `co decyduje ${name}` },
    requirement: { kind: 'required' },
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
    ...overrides,
  };
}

const DECLARED: readonly EnvironmentInput[] = [
  declaredInput('DATABASE_URL', { secret: true }),
  declaredInput('SESSION_COOKIE_SECRET', { secret: true, generable: true }),
  declaredInput('LOG_LEVEL', {
    requirement: {
      kind: 'optional',
      without: { en: 'the log carries the platform default', pl: 'dziennik ma poziom domyślny' },
    },
  }),
  declaredInput('SMTP_URL', {
    owner: { kind: 'module', moduleId: 'email' },
    requirement: {
      kind: 'optional',
      without: { en: 'mail goes to a console mailer', pl: 'poczta trafia do konsoli' },
    },
  }),
  declaredInput('VITE_API_BASE_URL', {
    owner: { kind: 'application', application: 'admin' },
    consumers: ['admin'],
    addressOf: 'backend',
  }),
];

/** The same plan input, with the admin member written (§2.4). */
function withAdminMemberInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return planInput({
    adminShellVersion: '4.5.6',
    adminKitVersion: '4.5.6',
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map(),
    ...overrides,
  });
}

function envExampleOf(input: PlanInput): string {
  return planInstance(input).files.find((file) => file.path === '.env.example')!.content;
}

function declaredNames(text: string): readonly string[] {
  return [...text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]!);
}

describe('G3 — `.env.example` declares every input the instance reads (FR-010)', () => {
  it('T3-B — the population is the declaration, not the five build inputs', () => {
    const names = declaredNames(envExampleOf(planInput({ declared: DECLARED })));
    // The build inputs stay: they are a different population and both belong
    // in the file (T3-B in its own words).
    for (const input of INSTANCE_BUILD_INPUTS) expect(names).toContain(input.name);
    // …and the runtime inputs the instance actually reads are there too, which
    // is the whole of the defect.
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('LOG_LEVEL');
    expect(names).toContain('SMTP_URL');
  });

  it('T3-B — a different module set is a different file, with no list edited', () => {
    const withEmail = declaredNames(envExampleOf(planInput({ declared: DECLARED })));
    const withoutEmail = declaredNames(
      envExampleOf(
        planInput({ declared: DECLARED.filter((input) => input.name !== 'SMTP_URL') }),
      ),
    );
    expect(withEmail).toContain('SMTP_URL');
    expect(withoutEmail).not.toContain('SMTP_URL');
  });

  it('the declaration\'s own sentences are carried across, never rewritten', () => {
    const text = envExampleOf(planInput({ declared: DECLARED }));
    expect(text).toContain('what DATABASE_URL decides');
    // An `optional` carries **what is lost**, which is the fact an operator
    // deciding whether to set it needs (`EnvironmentRequirementSchema`).
    expect(text).toContain('the log carries the platform default');
  });

  it('118 — an input no written member reads is out of the population', () => {
    // `VITE_API_BASE_URL` is the admin's. An instance with no admin member does
    // not ask a client for it; one with an admin member does.
    expect(declaredNames(envExampleOf(planInput({ declared: DECLARED })))).not.toContain(
      'VITE_API_BASE_URL',
    );
    expect(
      declaredNames(envExampleOf(withAdminMemberInput({ declared: DECLARED }))),
    ).toContain('VITE_API_BASE_URL');
  });

  it('FR-011 — a generable secret is in the written `.env` and in no `.env.example`', () => {
    const plan = planInstance(
      planInput({
        declared: DECLARED,
        generated: new Map([['SESSION_COOKIE_SECRET', 'a-generated-value']]),
      }),
    );
    const example = plan.files.find((file) => file.path === '.env.example')!.content;
    expect(declaredNames(example)).not.toContain('SESSION_COOKIE_SECRET');
    const env = plan.files.find((file) => file.path === '.env');
    expect(env, 'the command writes a `.env` for the value it generated').toBeDefined();
    expect(env!.content).toContain('SESSION_COOKIE_SECRET=a-generated-value');
    // R2.5d — the value appears in no source file and no `.env.example`.
    for (const file of plan.files) {
      if (file.path === '.env') continue;
      expect(file.content, file.path).not.toContain('a-generated-value');
    }
  });

  it('the written `.env` names every input the example does, so one file is edited', () => {
    const plan = planInstance(planInput({ declared: DECLARED }));
    const env = plan.files.find((file) => file.path === '.env')!.content;
    const example = plan.files.find((file) => file.path === '.env.example')!.content;
    for (const input of declaredEnvironmentInputs(DECLARED, false)) {
      expect(env, input.name).toContain(`#${input.name}=`);
    }
    // …and the build inputs are the example's alone: they are inlined by
    // `docker build` rather than read by a process, so a blank for each in the
    // file a client edits to start their instance would be four blanks that
    // change nothing.
    expect(declaredNames(example)).toContain('DEPLOYMENT');
  });

  /**
   * The 503 this rule was written from. A `.env` listing every optional input
   * as `NAME=` turned twenty *unset*s into twenty empty strings — Node's
   * `--env-file` makes no distinction — and the instance acceptance criterion's
   * health route answered 503 over a search engine that was running.
   */
  it('an unfilled placeholder is commented out, so writing the file changes nothing', () => {
    const plan = planInstance(planInput({ declared: DECLARED }));
    const env = plan.files.find((file) => file.path === '.env')!.content;
    // Not one bare assignment: every line that assigns is a value this run
    // actually has, and this run generated none.
    expect(declaredNames(env)).toEqual([]);
    expect(env).toContain('#DATABASE_URL=');
  });

  it('a generated value replaces its own placeholder rather than joining it', () => {
    const plan = planInstance(
      planInput({
        declared: DECLARED,
        generated: new Map([['SESSION_COOKIE_SECRET', 'a-generated-value']]),
      }),
    );
    const env = plan.files.find((file) => file.path === '.env')!.content;
    expect(env).toContain('SESSION_COOKIE_SECRET=a-generated-value');
    expect(env).not.toContain('#SESSION_COOKIE_SECRET=');
  });

  it('R1.2 — a `.env` the client placed first is merged into, never rewritten', () => {
    const plan = planInstance(
      planInput({
        declared: DECLARED,
        existingEnv: '# mine\nDATABASE_URL=postgresql://me@localhost/mine\n',
        generated: new Map([['SESSION_COOKIE_SECRET', 'a-generated-value']]),
      }),
    );
    const env = plan.files.find((file) => file.path === '.env')!.content;
    expect(env).toContain('# mine');
    expect(env).toContain('DATABASE_URL=postgresql://me@localhost/mine');
    expect(env).toContain('SESSION_COOKIE_SECRET=a-generated-value');
  });

  it('the written `.env` reaches the instance\'s own processes', () => {
    // Without this the file is inert: every root script runs `pnpm -C backend`,
    // so a `.env` at the root of the tree is read by nothing and a client who
    // filled it in still cannot start. The acceptance criterion never caught it
    // because it supplies the values through `process.env` instead.
    const backend = JSON.parse(
      planInstance(planInput({ declared: DECLARED })).files.find(
        (file) => file.path === 'backend/package.json',
      )!.content,
    ) as { scripts: Record<string, string> };
    const running = Object.entries(backend.scripts).filter(([, command]) =>
      command.includes('node '),
    );
    expect(running.length).toBeGreaterThan(5);
    for (const [name, command] of running) {
      expect(command, `backend script \`${name}\``).toContain('--env-file-if-exists=../.env');
    }
  });

  it('§2.6 — the written `.env` is git-ignored and the example is not', () => {
    const plan = planInstance(planInput({ declared: DECLARED }));
    const ignore = plan.files.find((file) => file.path === '.gitignore')!.content;
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).not.toMatch(/^\.env\.example$/m);
  });

  /**
   * The same set `endora new storefront` guarantees, asserted through git rather
   * than by reading lines: a `.env.local` holds the same secrets as `.env`, and
   * an installed or built tree is never the client's to commit.
   */
  it('§2.6 — git ignores local env files and the installed and built trees', () => {
    const plan = planInstance(planInput({ declared: DECLARED }));
    const dir = tempRoot();
    writeFileSync(join(dir, '.gitignore'), plan.files.find((file) => file.path === '.gitignore')!.content);
    expect(spawnSync('git', ['init', '-q'], { cwd: dir }).status).toBe(0);
    const probes = ['.env', '.env.local', 'node_modules/x', '.next/x', 'tsconfig.tsbuildinfo'];
    const checked = spawnSync('git', ['check-ignore', '--no-index', ...probes], { cwd: dir, encoding: 'utf8' });
    expect(checked.stdout.split('\n').filter(Boolean)).toEqual(probes);
    expect(spawnSync('git', ['check-ignore', '-q', '--no-index', '.env.example'], { cwd: dir }).status).toBe(1);
  });
});

describe('G3 — the declaration reaches the scaffolder from the packages it resolved (SC-005)', () => {
  /** A fixture install whose platform and modules both declare inputs. */
  function declaredFixture(): string {
    return installFixture([
      {
        ...PLATFORM,
        exports: {
          '.': { default: './manifest.js' },
          './env': { default: './env.js' },
        },
        rootSource: 'export {};\n',
        files: {
          'env.js':
            'export const PLATFORM_ENVIRONMENT_INPUTS = ' +
            JSON.stringify([
              {
                name: 'DATABASE_URL',
                describes: { en: 'the database', pl: 'baza' },
                requirement: { kind: 'required' },
                secret: true,
                generable: false,
                owner: { kind: 'platform' },
                consumers: ['backend'],
                addressOf: null,
              },
              {
                name: 'SESSION_COOKIE_SECRET',
                describes: { en: 'signs session cookies', pl: 'podpisuje ciasteczka' },
                requirement: { kind: 'required' },
                secret: true,
                generable: true,
                owner: { kind: 'platform' },
                consumers: ['backend'],
                addressOf: null,
              },
            ]) +
            ';\n',
        },
      },
      modulePackage('settings', {
        activation: { nonDeactivatable: true, reason: 'nothing runs without settings' },
      }),
      modulePackage('email', {
        env: [
          {
            name: 'SMTP_URL',
            describes: { en: 'where mail goes', pl: 'dokąd trafia poczta' },
            requirement: {
              kind: 'optional',
              without: { en: 'nothing is delivered', pl: 'nic nie jest dostarczane' },
            },
            secret: false,
            generable: false,
            owner: { kind: 'module', moduleId: 'email' },
            consumers: ['backend'],
            addressOf: null,
          },
        ],
      }),
    ]);
  }

  it('T3-E — the platform\'s and each installed module\'s declaration are read', async () => {
    const root = declaredFixture();
    const target = join(root, 'acme-shop');

    const result = await runNewInstance({
      dir: target,
      cwd: root,
      modules: ['settings', 'email'],
      dryRun: true,
    });
    const example = result.plan.files.find((file) => file.path === '.env.example')!.content;
    expect(example).toContain('DATABASE_URL=');
    expect(example).toContain('the database');
    expect(example).toContain('SMTP_URL=');
    expect(example).toContain('where mail goes');
  });

  it('T3-C — the generable secrets are generated, named and `defaulted` stays 0', async () => {
    const root = declaredFixture();
    const result = await runNewInstance({
      dir: join(root, 'acme-shop'),
      cwd: root,
      modules: ['settings'],
    });
    // R2.5d — the class is `generable && secret`, derived from the declaration.
    // A run that named one of them here would be the list this feature exists
    // to delete, and it would be wrong the moment a module declares a second.
    expect(result.wouldGenerate).toEqual([]);
    const generated = result.resolved.filter((entry) => entry.provenance === 'generated');
    expect(generated.map((entry) => entry.name)).toEqual(['SESSION_COOKIE_SECRET']);
    expect(result.provenance).toContain('generated=1 (SESSION_COOKIE_SECRET)');
    expect(result.provenance).toContain('defaulted=0');
    // …and it is on disk, in the file the operator can read it in.
    const written = readFileSync(join(root, 'acme-shop', '.env'), 'utf8');
    expect(written).toContain(`SESSION_COOKIE_SECRET=${generated[0]!.value}`);
    expect(readFileSync(join(root, 'acme-shop', '.env.example'), 'utf8')).not.toContain(
      'SESSION_COOKIE_SECRET',
    );
  });

  it('R2.4/R7.3 — a dry run generates nothing and names what it would have', async () => {
    const root = declaredFixture();
    const result = await runNewInstance({
      dir: join(root, 'acme-shop'),
      cwd: root,
      modules: ['settings'],
      dryRun: true,
    });
    expect(result.wouldGenerate).toEqual(['SESSION_COOKIE_SECRET']);
    expect(result.provenance).toContain('generated=0');
    expect(result.provenance).toContain('defaulted=0');
    expect(existsSync(join(root, 'acme-shop', '.env'))).toBe(false);
  });

  it('R1.2 — a `.env` the operator placed first answers tier 2 and is not generated over', async () => {
    const root = declaredFixture();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'SESSION_COOKIE_SECRET=mine-already\n', 'utf8');

    const result = await runNewInstance({ dir: target, cwd: root, modules: ['settings'] });
    expect(result.provenance).toContain('generated=0');
    expect(result.provenance).toContain('env-file=1');
    expect(readFileSync(join(target, '.env'), 'utf8')).toContain(
      'SESSION_COOKIE_SECRET=mine-already',
    );
  });
});
