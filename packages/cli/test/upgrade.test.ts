/**
 * `endora upgrade` — one release to the next (`specs/140-instance-upgrade/`).
 *
 * Every case here stands on a tree written to a temporary directory and on two
 * injected seams: the registry (which versions are published) and the step
 * runner (what would have been spawned). So a case asserts the **decisions** —
 * which line of which manifest moves, which lockfile entry is dropped, which
 * command runs in which directory — and none of them needs a network or a
 * package manager. What those decisions do to a real instance against npmjs is
 * measured outside this file and recorded in the spec (M1…M7).
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  compareVersions,
  pruneLockfile,
  rewriteManifestText,
  rewriteRange,
  runUpgrade,
  UpgradeHostError,
  UpgradeInputError,
  type RegistryProbe,
  type UpgradeStep,
} from '../src/upgrade/index.js';
import { planInstance, type PlanInput } from '../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'endora-upgrade-'));
  scratch.push(dir);
  return dir;
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The release this CLI says it belongs to — the population that moves. */
const RELEASE_NAMES = [
  'admin-shell',
  'cli',
  'contracts',
  'mod-settings',
  'page-builder-core',
  'platform',
].map((name) => `${SCOPE}${name}`);

function releaseIndex(root: string, version = '0.1.0'): string {
  const file = join(root, 'release-index.json');
  write(
    file,
    json({
      packages: RELEASE_NAMES.map((name) => ({ name, version })),
      packageManager: 'pnpm@9.15.0',
    }),
  );
  return file;
}

/** A pnpm 9 lockfile holding the given package keys, each with a body. */
function lockfile(keys: readonly string[]): string {
  const body = keys.map((key) => `  '${key}':\n    resolution: {integrity: sha512-x}\n`).join('\n');
  const snapshots = keys.map((key) => `  '${key}': {}\n`).join('\n');
  return (
    "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\nimporters:\n\n  .:\n" +
    `    dependencies:\n      '${SCOPE}platform':\n        specifier: ^0.1.0\n        version: 0.1.0\n\n` +
    `packages:\n\n${body}\nsnapshots:\n\n${snapshots}`
  );
}

interface Tree {
  readonly root: string;
  readonly instance: string;
  readonly storefront: string;
  readonly index: string;
}

/**
 * An instance at `installed`, as `endora install` leaves one: three members,
 * an exact `contracts` pin, a paid module of the same scope at its own version,
 * a third-party range, and the storefront beside it.
 */
function tree(options: { installed?: string; ranges?: string; storefront?: boolean } = {}): Tree {
  const installed = options.installed ?? '0.1.0';
  const ranges = options.ranges ?? installed;
  const root = temp();
  const instance = join(root, 'acme-shop');
  write(
    join(instance, 'package.json'),
    json({
      name: 'acme-shop',
      private: true,
      scripts: { setup: 'pnpm run generate && pnpm run build', upgrade: 'endora upgrade' },
      dependencies: {
        [`${SCOPE}contracts`]: ranges,
        [`${SCOPE}mod-inpost`]: '^0.10.0',
        [`${SCOPE}mod-settings`]: `^${ranges}`,
        [`${SCOPE}platform`]: `^${ranges}`,
        react: '^19',
      },
      devDependencies: { [`${SCOPE}cli`]: `^${ranges}`, typescript: '^5.9.3' },
    }),
  );
  write(join(instance, 'pnpm-workspace.yaml'), 'packages:\n  - backend\n  - admin\n');
  write(join(instance, 'backend', 'package.json'), json({ name: 'acme-shop-backend' }));
  write(
    join(instance, 'admin', 'package.json'),
    json({
      name: 'acme-shop-admin',
      dependencies: { [`${SCOPE}admin-shell`]: `^${ranges}` },
      devDependencies: { [`${SCOPE}cli`]: `^${ranges}`, vite: '^7' },
    }),
  );
  write(
    join(instance, 'node_modules', '@endora-commerce', 'platform', 'package.json'),
    json({ name: `${SCOPE}platform`, version: installed }),
  );
  write(
    join(instance, 'pnpm-lock.yaml'),
    lockfile([
      `${SCOPE}platform@${installed}`,
      `${SCOPE}contracts@${installed}`,
      `${SCOPE}page-builder-core@${installed}`,
      `${SCOPE}mod-inpost@0.10.0`,
      'react@19.3.0',
    ]),
  );
  const storefront = join(root, 'acme-shop-storefront');
  if (options.storefront !== false) {
    write(
      join(storefront, 'package.json'),
      json({
        name: 'acme-shop-storefront',
        dependencies: {
          [`${SCOPE}contracts`]: ranges,
          [`${SCOPE}page-builder-core`]: `^${ranges}`,
          next: '^15.5.15',
        },
      }),
    );
    write(
      join(storefront, 'pnpm-lock.yaml'),
      lockfile([`${SCOPE}contracts@${installed}`, `${SCOPE}page-builder-core@${installed}`]),
    );
  }
  return { root, instance, storefront, index: releaseIndex(root) };
}

/** A registry that publishes every release package at each of `versions`. */
function registry(versions: readonly string[], missing: readonly string[] = []): RegistryProbe {
  return async (name, spec) => {
    if (spec === 'latest') return versions[versions.length - 1] ?? null;
    if (missing.includes(`${name}@${spec}`)) return null;
    return versions.includes(spec) ? spec : null;
  };
}

/** A runner that records and answers 0, or the given code for one step. */
function recorder(fail?: { id: UpgradeStep['id']; code: number }): {
  readonly ran: UpgradeStep[];
  readonly run: (step: UpgradeStep) => Promise<number>;
} {
  const ran: UpgradeStep[] = [];
  return {
    ran,
    run: async (step) => {
      ran.push(step);
      return fail !== undefined && fail.id === step.id ? fail.code : 0;
    },
  };
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function deps(file: string): Record<string, string> {
  const manifest = JSON.parse(read(file)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...manifest.dependencies, ...manifest.devDependencies };
}

// ---------------------------------------------------------------------------
// FR-003 — a range keeps its operator
// ---------------------------------------------------------------------------

describe('rewriteRange — the operator survives, the version moves (FR-003)', () => {
  it('an exact pin stays exact, `^` stays `^`, `~` stays `~`', () => {
    expect(rewriteRange('0.101.0', '0.101.1')).toBe('0.101.1');
    expect(rewriteRange('^0.101.0', '0.102.0')).toBe('^0.102.0');
    expect(rewriteRange('~0.101.0', '0.101.1')).toBe('~0.101.1');
    expect(rewriteRange('0.101.1-rc.1', '0.101.1')).toBe('0.101.1');
  });

  it('a spec that is not a version range is not ours to move', () => {
    for (const spec of [
      'file:../cli.tgz',
      'link:../cli',
      'workspace:*',
      'npm:@other/cli@1.0.0',
      'latest',
      '>=0.100.0',
      '*',
      'https://example.com/cli.tgz',
      '0.101.x',
    ]) {
      expect(rewriteRange(spec, '0.101.1'), spec).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('orders by number, and a pre-release before its release', () => {
    expect(compareVersions('0.101.1', '0.101.0')).toBeGreaterThan(0);
    expect(compareVersions('0.99.9', '0.100.0')).toBeLessThan(0);
    expect(compareVersions('0.101.1', '0.101.1')).toBe(0);
    expect(compareVersions('0.102.0-rc.1', '0.102.0')).toBeLessThan(0);
    expect(compareVersions('0.102.0-rc.1', '0.101.9')).toBeGreaterThan(0);
  });
});

describe('rewriteManifestText — only release packages move, and nothing else changes (FR-002, FR-003)', () => {
  const names = new Set(RELEASE_NAMES);

  it('rewrites the release ranges in place and leaves every other byte alone', () => {
    const text =
      '{\n    "name": "x",\n    "dependencies": {\n' +
      `        "${SCOPE}contracts": "0.1.0",\n` +
      `        "${SCOPE}mod-inpost": "^0.10.0",\n` +
      `        "${SCOPE}platform": "^0.1.0",\n` +
      '        "react": "^19"\n    },\n' +
      `    "devDependencies": { "${SCOPE}cli": "file:../cli.tgz" }\n}\n`;
    const result = rewriteManifestText(text, names, '0.2.0');
    expect(result.text).toBe(
      text
        .replace(`"${SCOPE}contracts": "0.1.0"`, `"${SCOPE}contracts": "0.2.0"`)
        .replace(`"${SCOPE}platform": "^0.1.0"`, `"${SCOPE}platform": "^0.2.0"`),
    );
    expect(result.changes).toEqual([
      { name: `${SCOPE}contracts`, from: '0.1.0', to: '0.2.0' },
      { name: `${SCOPE}platform`, from: '^0.1.0', to: '^0.2.0' },
    ]);
    // The paid module is not in the release, so it is reported rather than
    // silently skipped; the third-party range is nobody's business here.
    expect(result.left).toEqual([
      { name: `${SCOPE}cli`, spec: 'file:../cli.tgz', why: 'not a version range' },
      { name: `${SCOPE}mod-inpost`, spec: '^0.10.0', why: 'not part of this release' },
    ]);
    expect(result.declared).toEqual([`${SCOPE}contracts`, `${SCOPE}platform`]);
  });

  it('a manifest already at the target changes nothing', () => {
    const text = json({ dependencies: { [`${SCOPE}contracts`]: '0.2.0', [`${SCOPE}platform`]: '^0.2.0' } });
    const result = rewriteManifestText(text, names, '0.2.0');
    expect(result.text).toBe(text);
    expect(result.changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FR-004 — the lockfile forgets the release it is leaving
// ---------------------------------------------------------------------------

describe('pruneLockfile — auto-installed peers are re-resolved, not kept (FR-004, M4)', () => {
  const names = new Set(RELEASE_NAMES);

  it('drops every package and snapshot entry naming a release package at another version', () => {
    const text = lockfile([
      `${SCOPE}page-builder-core@0.1.0`,
      `${SCOPE}platform@0.2.0`,
      `${SCOPE}mod-inpost@0.10.0`,
      'react@19.3.0',
    ]).replace(
      `  '${SCOPE}platform@0.2.0': {}\n`,
      `  '${SCOPE}platform@0.2.0(${SCOPE}page-builder-core@0.1.0)': {}\n`,
    );
    const result = pruneLockfile(text, names, '0.2.0');
    expect(result.dropped).toEqual([
      `${SCOPE}page-builder-core@0.1.0`,
      `${SCOPE}page-builder-core@0.1.0`,
      `${SCOPE}platform@0.2.0(${SCOPE}page-builder-core@0.1.0)`,
    ]);
    expect(result.text).not.toContain('page-builder-core@0.1.0');
    expect(result.text).toContain(`'${SCOPE}platform@0.2.0':`);
    expect(result.text).toContain(`'${SCOPE}mod-inpost@0.10.0':`);
    expect(result.text).toContain("'react@19.3.0':");
    // The importers are pnpm's to reconcile against the new specifiers.
    expect(result.text).toContain('importers:');
  });

  it('a lockfile already at the target is returned unchanged', () => {
    const text = lockfile([`${SCOPE}platform@0.2.0`, 'react@19.3.0']);
    const result = pruneLockfile(text, names, '0.2.0');
    expect(result.text).toBe(text);
    expect(result.dropped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The verb
// ---------------------------------------------------------------------------

describe('runUpgrade — moves the release, installs, runs `setup` (FR-001, FR-006)', () => {
  it('rewrites every member and the storefront, then runs three commands in order', async () => {
    const t = tree();
    const runner = recorder();
    const result = await runUpgrade({
      cwd: join(t.instance, 'admin'),
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });

    expect(result.exitCode).toBe(0);
    expect(result.upToDate).toBe(false);
    expect([result.from, result.to]).toEqual(['0.1.0', '0.2.0']);
    expect(deps(join(t.instance, 'package.json'))).toEqual({
      [`${SCOPE}contracts`]: '0.2.0',
      [`${SCOPE}mod-inpost`]: '^0.10.0',
      [`${SCOPE}mod-settings`]: '^0.2.0',
      [`${SCOPE}platform`]: '^0.2.0',
      react: '^19',
      [`${SCOPE}cli`]: '^0.2.0',
      typescript: '^5.9.3',
    });
    expect(deps(join(t.instance, 'admin', 'package.json'))).toEqual({
      [`${SCOPE}admin-shell`]: '^0.2.0',
      [`${SCOPE}cli`]: '^0.2.0',
      vite: '^7',
    });
    expect(deps(join(t.storefront, 'package.json'))).toEqual({
      [`${SCOPE}contracts`]: '0.2.0',
      [`${SCOPE}page-builder-core`]: '^0.2.0',
      next: '^15.5.15',
    });
    expect(read(join(t.instance, 'pnpm-lock.yaml'))).not.toMatch(/@endora-commerce\/[a-z-]+@0\.1\.0/);
    expect(read(join(t.instance, 'pnpm-lock.yaml'))).toContain(`'${SCOPE}mod-inpost@0.10.0':`);
    expect(read(join(t.storefront, 'pnpm-lock.yaml'))).not.toContain('@0.1.0');

    expect(runner.ran.map((step) => [step.id, step.bin, step.argv.join(' '), step.cwd])).toEqual([
      ['install', 'pnpm', 'install', t.instance],
      ['setup', 'pnpm', 'run setup', t.instance],
      ['storefront-install', 'pnpm', 'install', t.storefront],
    ]);
    // FR-006: each is printed before it runs, as a person types it.
    const printed = result.lines.join('\n');
    expect(printed).toContain('[1/3] pnpm install');
    expect(printed).toContain('[2/3] pnpm run setup');
    expect(printed).toContain(`[3/3] pnpm install   # in ${t.storefront}`);
    expect(printed).toContain(`${SCOPE}mod-inpost ^0.10.0 — not part of this release`);
  });

  it('with no version, takes the registry\'s latest of the platform', async () => {
    const t = tree();
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      registry: registry(['0.1.0', '0.1.1', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.to).toBe('0.2.0');
    expect(result.lines.join('\n')).toContain("the registry's latest");
    expect(deps(join(t.instance, 'package.json'))[`${SCOPE}platform`]).toBe('^0.2.0');
  });

  it('a failing step exits with its own code and prints what is left (FR-006)', async () => {
    const t = tree();
    const runner = recorder({ id: 'setup', code: 70 });
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.exitCode).toBe(70);
    expect(runner.ran.map((step) => step.id)).toEqual(['install', 'setup']);
    const printed = result.lines.join('\n');
    expect(printed).toContain('pnpm run setup failed (exit 70). Remaining steps, in order:');
    expect(printed).toContain(`cd ${t.instance} && pnpm run setup`);
    expect(printed).toContain(`cd ${t.storefront} && pnpm install`);
  });

  it('`--no-storefront` leaves the storefront exactly as it was', async () => {
    const t = tree();
    const before = read(join(t.storefront, 'package.json'));
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      storefront: false,
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.storefrontDir).toBeNull();
    expect(read(join(t.storefront, 'package.json'))).toBe(before);
    expect(runner.ran.map((step) => step.id)).toEqual(['install', 'setup']);
  });

  it('no storefront beside the instance is not a refusal', async () => {
    const t = tree({ storefront: false });
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.exitCode).toBe(0);
    expect(result.storefrontDir).toBeNull();
    expect(runner.ran.map((step) => step.id)).toEqual(['install', 'setup']);
  });
});

describe('runUpgrade — already there is a no-op that says so (FR-007)', () => {
  it('writes nothing, runs nothing, exits 0', async () => {
    const t = tree({ installed: '0.2.0' });
    const before = [
      read(join(t.instance, 'package.json')),
      read(join(t.instance, 'pnpm-lock.yaml')),
      read(join(t.storefront, 'package.json')),
    ];
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.exitCode).toBe(0);
    expect(result.upToDate).toBe(true);
    expect(runner.ran).toEqual([]);
    expect([
      read(join(t.instance, 'package.json')),
      read(join(t.instance, 'pnpm-lock.yaml')),
      read(join(t.storefront, 'package.json')),
    ]).toEqual(before);
    expect(result.lines.join('\n')).toContain('already at 0.2.0 — nothing to do');
  });

  it('ranges at the target over an install that is not is NOT up to date — the install still runs', async () => {
    // A run whose install step failed leaves exactly this tree behind.
    const t = tree({ installed: '0.1.0', ranges: '0.2.0' });
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.upToDate).toBe(false);
    expect(runner.ran.map((step) => step.id)).toEqual(['install', 'setup', 'storefront-install']);
  });
});

describe('runUpgrade — a scaffold of an older release, already mixed (M8)', () => {
  it('reports the release the manifest names, and repairs the pin a caret overtook', async () => {
    // `create-endora-commerce@0.101.0` run after 0.101.1 was out writes
    // `^0.101.0` everywhere and `contracts` exactly at 0.101.0, and installs
    // the platform at 0.101.1: two copies of the contracts from the first day.
    const t = tree({ installed: '0.2.0', ranges: '0.1.0' });
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect([result.from, result.to, result.upToDate]).toEqual(['0.1.0', '0.2.0', false]);
    expect(result.lines[0]).toContain(': 0.1.0 → 0.2.0');
    expect(deps(join(t.instance, 'package.json'))[`${SCOPE}contracts`]).toBe('0.2.0');
    expect(runner.ran.map((step) => step.id)).toEqual(['install', 'setup', 'storefront-install']);
  });
});

describe('runUpgrade — validate completely, then write (FR-005)', () => {
  it('a release package the target does not publish is a refusal naming every one, and nothing is written', async () => {
    const t = tree();
    const before = read(join(t.instance, 'package.json'));
    const runner = recorder();
    const attempt = runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      registry: registry(['0.1.0', '0.2.0'], [`${SCOPE}mod-settings@0.2.0`, `${SCOPE}admin-shell@0.2.0`]),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    await expect(attempt).rejects.toBeInstanceOf(UpgradeInputError);
    await expect(attempt).rejects.toThrow(/admin-shell@0\.2\.0[\s\S]*mod-settings@0\.2\.0/);
    expect(read(join(t.instance, 'package.json'))).toBe(before);
    expect(runner.ran).toEqual([]);
  });

  it('a target nobody published is refused', async () => {
    const t = tree();
    await expect(
      runUpgrade({
        cwd: t.instance,
        version: '0.9.0',
        registry: registry(['0.1.0', '0.2.0']),
        releaseIndexFile: t.index,
        run: recorder().run,
      }),
    ).rejects.toThrow(/0\.9\.0/);
  });

  it('a downgrade is refused: migrations do not run backwards', async () => {
    const t = tree({ installed: '0.2.0' });
    const before = read(join(t.instance, 'package.json'));
    await expect(
      runUpgrade({
        cwd: t.instance,
        version: '0.1.0',
        registry: registry(['0.1.0', '0.2.0']),
        releaseIndexFile: t.index,
        run: recorder().run,
      }),
    ).rejects.toThrow(/older than the installed 0\.2\.0/);
    expect(read(join(t.instance, 'package.json'))).toBe(before);
  });

  it('a version that is not one is refused before anything is asked of the registry', async () => {
    const t = tree();
    let asked = 0;
    await expect(
      runUpgrade({
        cwd: t.instance,
        version: '^0.2.0',
        registry: async () => {
          asked += 1;
          return null;
        },
        releaseIndexFile: t.index,
        run: recorder().run,
      }),
    ).rejects.toBeInstanceOf(UpgradeInputError);
    expect(asked).toBe(0);
  });

  it('a named storefront that is not there is refused', async () => {
    const t = tree();
    await expect(
      runUpgrade({
        cwd: t.instance,
        version: '0.2.0',
        storefront: '../nowhere',
        registry: registry(['0.1.0', '0.2.0']),
        releaseIndexFile: t.index,
        run: recorder().run,
      }),
    ).rejects.toThrow(/nowhere/);
  });

  it('outside an instance is an input it could not read — exit 2', async () => {
    const root = temp();
    await expect(
      runUpgrade({
        cwd: root,
        version: '0.2.0',
        registry: registry(['0.2.0']),
        releaseIndexFile: releaseIndex(root),
        run: recorder().run,
      }),
    ).rejects.toBeInstanceOf(UpgradeHostError);
  });

  it('an instance whose platform is not installed is told to install first', async () => {
    const t = tree();
    rmSync(join(t.instance, 'node_modules'), { recursive: true, force: true });
    await expect(
      runUpgrade({
        cwd: t.instance,
        version: '0.2.0',
        registry: registry(['0.1.0', '0.2.0']),
        releaseIndexFile: t.index,
        run: recorder().run,
      }),
    ).rejects.toThrow(/pnpm install/);
  });
});

describe('runUpgrade — `--dry-run` reports and does nothing (FR-008)', () => {
  it('prints every change and every step, writes nothing and runs nothing', async () => {
    const t = tree();
    const before = read(join(t.instance, 'package.json'));
    const lockBefore = read(join(t.instance, 'pnpm-lock.yaml'));
    const runner = recorder();
    const result = await runUpgrade({
      cwd: t.instance,
      version: '0.2.0',
      dryRun: true,
      registry: registry(['0.1.0', '0.2.0']),
      releaseIndexFile: t.index,
      run: runner.run,
    });
    expect(result.exitCode).toBe(0);
    expect(runner.ran).toEqual([]);
    expect(read(join(t.instance, 'package.json'))).toBe(before);
    expect(read(join(t.instance, 'pnpm-lock.yaml'))).toBe(lockBefore);
    const printed = result.lines.join('\n');
    expect(printed).toContain('dry run');
    expect(printed).toContain(`${SCOPE}contracts 0.1.0 → 0.2.0`);
    expect(printed).toContain(`${SCOPE}platform ^0.1.0 → ^0.2.0`);
    expect(printed).toContain('pnpm run setup');
    expect(existsSync(join(t.instance, 'package.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FR-009 — a new instance carries the root script
// ---------------------------------------------------------------------------

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '1.2.3' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map(),
    declaredRanges: new Map([['typescript', '^5.9.3']]),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    declared: [],
    existingEnv: '',
    generated: new Map(),
    ...overrides,
  };
}

describe('FR-009 — a scaffolded instance declares `upgrade`, and its README names it', () => {
  it('runs the CLI the instance already declares', () => {
    const plan = planInstance(planInput());
    const manifest = JSON.parse(plan.files.find((file) => file.path === 'package.json')!.content) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts['upgrade']).toBe('endora upgrade');
    expect(manifest.devDependencies[`${SCOPE}cli`]).toBeDefined();
    const readme = plan.files.find((file) => file.path === 'README.md')!.content;
    expect(readme).toMatch(/^pnpm run upgrade \[<version>\]\s+# /m);
    // The sentence that sent clients to `pnpm update` is gone (M1, M2): it is
    // named now only as the command that is not the upgrade.
    expect(readme).not.toContain('reaches you through `pnpm update`');
    expect(readme).toContain('is `pnpm run upgrade`, not `pnpm update`');
  });

  it('is absent exactly when the CLI is not on the root path', () => {
    const plan = planInstance(planInput({ modules: [], without: new Set(['admin', 'docs']) }));
    const manifest = JSON.parse(plan.files.find((file) => file.path === 'package.json')!.content) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['upgrade']).toBeUndefined();
    expect(manifest.scripts['dev:all']).toBeUndefined();
  });
});
