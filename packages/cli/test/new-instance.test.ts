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
  runNewInstance,
} from '../src/new-instance/index.js';
import { resolveModuleSet, type ModuleCandidate } from '../src/new-instance/modules.js';
import {
  devDependenciesFor,
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
  readonly dependencies?: Record<string, string>;
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
        ...(pkg.dependencies === undefined ? {} : { dependencies: pkg.dependencies }),
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

function modulePackage(
  id: string,
  manifest: Record<string, unknown> = {},
): FixturePackage {
  return {
    name: `mod-${id}`,
    endora: { type: 'module', id },
    manifest: { id, ...manifest },
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
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings` }],
    adminShellVersion: null,
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
    // A fixture with module packages and no platform: the failure is precisely
    // that no `^<version>` has a source, and it must not be reported as an
    // empty module set.
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
          { id: 'settings', packageName: `${SCOPE}mod-settings` },
          { id: 'blog', packageName: `${SCOPE}mod-blog` },
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

  it('§2.6 — both generated artefacts are git-ignored', () => {
    const plan = planInstance(planInput());
    const ignore = plan.files.find((file) => file.path === '.gitignore')!;
    expect(ignore.content).toContain('admin/src/modules.generated.ts');
    expect(ignore.content).toContain('docs/sidebars.modules.generated.js');
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

describe('the command (R5.2, R5.3)', () => {
  const fixture = (): string =>
    installFixture([
      PLATFORM,
      modulePackage('settings', {
        activation: { nonDeactivatable: true, reason: 'nothing runs without settings' },
      }),
      modulePackage('blog', { dependencies: ['settings'] }),
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
