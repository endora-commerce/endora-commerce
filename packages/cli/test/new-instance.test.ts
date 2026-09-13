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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  InstanceHostError,
  InstanceInputError,
  nextSteps,
  runNewInstance,
} from '../src/new-instance/index.js';
import { resolveModuleSet, type ModuleCandidate } from '../src/new-instance/modules.js';
import {
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
    required: false,
    reason: undefined,
    carriedByHost: false,
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
      // and that member's own script of the same name. The member is read out
      // of the `-C <dir>` token rather than assumed to be the backend, so the
      // admin and documentation members are covered by the same assertion and
      // a third member would be too.
      for (const [, directory] of command.matchAll(/pnpm -C (\S+) run (\S+)/g)) {
        delegations += 1;
        const manifest = plan.files.find((file) => file.path === `${directory}/package.json`);
        expect(manifest, `${name} delegates to ${directory}, which the plan does not write`)
          .toBeDefined();
        const scripts = (JSON.parse(manifest!.content) as { scripts: Record<string, string> })
          .scripts;
        expect(scripts[name]).toBeDefined();
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
    const steps = nextSteps('/tmp/acme', 'default');
    const text = steps.join('\n');
    expect(text).toContain('pnpm run build');
    expect(text).toContain('pnpm run module:install --all');
    expect(steps.findIndex((s) => s.startsWith('pnpm run build'))).toBeLessThan(
      steps.findIndex((s) => s.startsWith('pnpm run migrate')),
    );
    expect(steps.findIndex((s) => s.startsWith('pnpm run migrate'))).toBeLessThan(
      steps.findIndex((s) => s.startsWith('pnpm run module:install')),
    );
    expect(steps.findIndex((s) => s.startsWith('pnpm run module:install'))).toBeLessThan(
      steps.findIndex((s) => s.startsWith('pnpm run start')),
    );
  });

  it('R1.4 — the wiring is under the bound, measured on the plan', () => {
    expect(wiringLineCount(planInstance(planInput()))).toBeLessThan(250);
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
    // A tree with **neither** generated member: no `generate` at all, rather
    // than a script that fails on a directory nobody wrote. One member absent
    // is not that state — the documentation site generates its own pair.
    const without = scripts(planInstance(planInput({ docsRanges: new Map() })));
    expect(without['generate']).toBeUndefined();
    expect(without['build']).toBe('pnpm -C backend run build');
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
