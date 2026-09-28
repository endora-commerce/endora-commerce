/**
 * The install verb's default module set — D-270
 * (`specs/080-f4-real-scope/rulings.md`; `specs/125-first-mile-install/spec.md`
 * §6.2 as amended).
 *
 * With no `--module`, `endora install` seeds the set with **every module
 * package the run resolved whose package is not separately licensed**, closed
 * exactly as before; `endora new instance` keeps `instance-tree.md` R3.2's
 * smallest set. Both are one function, `resolveModuleSet`, taking a seed
 * policy — so there is still one derivation, and the install verb passes a
 * policy and names no module (125 FR-143).
 *
 * "Separately licensed" is read off the package's own `license` field: the
 * `SEE LICENSE IN <file>` form and `UNLICENSED`. A module the platform package
 * itself carries takes the platform's licence. A free module whose closure
 * reaches a separately licensed one is a refusal, never a silent inclusion
 * (D-270 clause 4, D-265 clause 3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runInstall, type InstallStep } from '../src/install/index.js';
import { InstanceHostError, InstanceInputError, resolveInstanceHost } from '../src/new-instance/host.js';
import { runNewInstance } from '../src/new-instance/index.js';
import {
  loadModuleCandidates,
  resolveModuleSet,
  separatelyLicensed,
  type ModuleCandidate,
} from '../src/new-instance/modules.js';

import { ADMIN, cleanScratch, installFixture, temp } from './support/install-host.js';

afterEach(cleanScratch);

const SCOPE = '@endora-commerce/';

function candidate(id: string, overrides: Partial<ModuleCandidate> = {}): ModuleCandidate {
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

/** Add one module package beside a fixture install. */
function addModule(
  root: string,
  directory: string,
  id: string,
  options: { readonly license?: string; readonly manifest?: string } = {},
): void {
  const dir = join(root, 'node_modules', '@endora-commerce', directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `@endora-commerce/${directory}`,
      version: '1.2.3',
      type: 'module',
      ...(options.license === undefined ? {} : { license: options.license }),
      endora: { type: 'module', id },
      exports: { '.': { default: './manifest.js' } },
    }),
    'utf8',
  );
  writeFileSync(
    join(dir, 'manifest.js'),
    options.manifest ?? `export const manifest = { id: '${id}', dependencies: ['settings'] };\n`,
    'utf8',
  );
}

/**
 * A host with the three kinds of module the ruling distinguishes: required
 * (`settings`), optional and free (`admin_users` from the shared fixture, plus
 * `returns`, which declares MIT outright), and separately licensed (`erp_link`).
 */
function mixedHost(): string {
  const root = temp('endora-default-set-');
  installFixture(root);
  addModule(root, 'mod-returns', 'returns', { license: 'MIT' });
  addModule(root, 'mod-erp-link', 'erp_link', { license: 'SEE LICENSE IN LICENSE.md' });
  return root;
}

function recorder(): { readonly run: (step: InstallStep) => Promise<number> } {
  return { run: async () => 0 };
}

function installOptions(
  root: string,
  overrides: Record<string, unknown> = {},
): Parameters<typeof runInstall>[0] {
  return {
    dir: join(root, 'acme-shop'),
    cwd: root,
    storefront: false,
    services: false,
    dockerReachable: true,
    demo: false,
    ...ADMIN,
    ...recorder(),
    ...overrides,
  } as Parameters<typeof runInstall>[0];
}

describe('separatelyLicensed — the predicate, off the package\'s own `license`', () => {
  it('reads `SEE LICENSE IN <file>` and `UNLICENSED` as separately licensed, anything else as not', () => {
    expect(separatelyLicensed('SEE LICENSE IN LICENSE.md')).toBe(true);
    expect(separatelyLicensed('see license in TERMS')).toBe(true);
    expect(separatelyLicensed('UNLICENSED')).toBe(true);
    expect(separatelyLicensed('MIT')).toBe(false);
    expect(separatelyLicensed('(MIT OR Apache-2.0)')).toBe(false);
    // No field at all is not a claim of separate terms: the open core's modules
    // take the workspace root's licence and several declare none of their own.
    expect(separatelyLicensed(undefined)).toBe(false);
  });
});

describe('resolveModuleSet — the seed policy (D-270 clause 1)', () => {
  const set = (): Map<string, ModuleCandidate> =>
    candidates(
      candidate('settings', { required: true, reason: 'required', license: 'MIT' }),
      candidate('auth', { required: true, reason: 'required', dependencies: ['settings'] }),
      candidate('returns', { dependencies: ['orders'], license: 'MIT' }),
      candidate('orders', { dependencies: ['settings'] }),
      candidate('erp_link', { dependencies: ['orders'], license: 'SEE LICENSE IN LICENSE.md' }),
      candidate('legacy_bridge', { license: 'UNLICENSED' }),
    );

  it('the default policy is unchanged: the smallest set that composes', () => {
    const resolution = resolveModuleSet([], set());
    expect(resolution.defaulted).toBe(true);
    expect(resolution.ids).toEqual(['auth', 'settings']);
  });

  it("`seed: 'available'` seeds every module that is not separately licensed, closed", () => {
    const resolution = resolveModuleSet([], set(), { seed: 'available' });
    expect(resolution.defaulted).toBe(true);
    expect(resolution.ids).toEqual(['auth', 'orders', 'returns', 'settings']);
    expect(resolution.ids).not.toContain('erp_link');
    expect(resolution.ids).not.toContain('legacy_bridge');
  });

  it('a named `--module` set is unchanged by the policy — explicit, closed, refused as before', () => {
    const resolution = resolveModuleSet(['returns', 'auth'], set(), { seed: 'available' });
    expect(resolution.defaulted).toBe(false);
    expect(resolution.ids).toEqual(['auth', 'orders', 'returns', 'settings']);
    // F2 for an omitted required module stands under either policy.
    expect(() => resolveModuleSet(['returns'], set(), { seed: 'available' })).toThrow(
      InstanceInputError,
    );
  });

  it('clause 4 — a free module whose closure reaches a separately licensed one is refused', () => {
    const withEdge = candidates(
      candidate('settings', { required: true, reason: 'required' }),
      candidate('quotes', { dependencies: ['erp_link'] }),
      candidate('erp_link', { license: 'SEE LICENSE IN LICENSE.md' }),
    );
    let thrown: unknown;
    try {
      resolveModuleSet([], withEdge, { seed: 'available' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstanceInputError);
    expect((thrown as InstanceInputError).refusal).toBe('F2');
    // It names the free module whose edge is the defect, and the edge itself.
    expect((thrown as Error).message).toContain('quotes');
    expect((thrown as Error).message).toContain('separately licensed');
    // …and the same edge through `acknowledgedDependencies` is the same refusal.
    const acknowledged = candidates(
      candidate('settings', { required: true, reason: 'required' }),
      candidate('quotes', { acknowledged: ['erp_link'] }),
      candidate('erp_link', { license: 'UNLICENSED' }),
    );
    expect(() => resolveModuleSet([], acknowledged, { seed: 'available' })).toThrow(/quotes/);
  });
});

describe('ModuleCandidate.license — read off the package, the platform\'s for a carried module', () => {
  it('a module package carries its own `license`; a host-carried module carries the platform\'s', async () => {
    const root = temp('endora-license-');
    installFixture(root);
    addModule(root, 'mod-returns', 'returns', { license: 'MIT' });
    addModule(root, 'mod-erp-link', 'erp_link', { license: 'SEE LICENSE IN LICENSE.md' });
    // The platform carries one module of its own through a subpath export.
    const platformDir = join(root, 'node_modules', '@endora-commerce', 'platform');
    const platformManifest = JSON.parse(readFileSync(join(platformDir, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    platformManifest.exports['./lifecycle'] = { default: './lifecycle.js' };
    writeFileSync(
      join(platformDir, 'package.json'),
      JSON.stringify({ ...platformManifest, license: 'MIT' }),
      'utf8',
    );
    writeFileSync(
      join(platformDir, 'lifecycle.js'),
      `export const manifest = { id: '_lifecycle', activation: { nonDeactivatable: true } };\n`,
      'utf8',
    );

    const host = resolveInstanceHost({ cwd: root, targetDir: join(root, 'acme-shop') });
    const platform = host.packages.get(`${SCOPE}platform`)!;
    const { candidates: loaded } = await loadModuleCandidates(host.packages, platform);
    expect(loaded.get('returns')!.license).toBe('MIT');
    expect(loaded.get('erp_link')!.license).toBe('SEE LICENSE IN LICENSE.md');
    expect(loaded.get('_lifecycle')!.carriedByHost).toBe(true);
    expect(loaded.get('_lifecycle')!.license).toBe('MIT');
    // A package that declares no licence reads as `undefined`, not as a guess.
    expect(loaded.get('settings')!.license).toBeUndefined();
  });
});

describe('`endora install` — every module of the open-source set, by default (T-D2)', () => {
  it('a bare run declares the required and the optional free modules, and no separately licensed one', async () => {
    const root = mixedHost();
    const result = await runInstall(installOptions(root));
    expect(result.instance.modules.defaulted).toBe(true);
    expect(result.instance.modules.ids).toEqual(['admin_users', 'returns', 'settings']);
    const manifest = JSON.parse(readFileSync(join(root, 'acme-shop', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).toContain('@endora-commerce/mod-returns');
    expect(Object.keys(manifest.dependencies)).not.toContain('@endora-commerce/mod-erp-link');
    // D-265 / D-270 clause 4 — the output names no paid module.
    const text = result.output.join('\n');
    expect(text).not.toContain('erp_link');
    expect(text).not.toContain('mod-erp-link');
  });

  it('the closing block names the count, that no `--module` was given, and the reversal', async () => {
    const root = mixedHost();
    const result = await runInstall(installOptions(root));
    const text = result.output.join('\n');
    expect(text).toContain('3 modules');
    expect(text).toContain('no `--module` was given');
    expect(text).toContain('/platform/modules');
    // Not an input: the `[inputs]` provenance line is untouched (R2.5a).
    expect(result.instance.provenance).toContain('defaulted=0');
  });

  it('`--module` is unchanged: an explicit set, closed, and no default sentence', async () => {
    const root = mixedHost();
    const result = await runInstall(installOptions(root, { modules: ['admin_users'] }));
    expect(result.instance.modules.defaulted).toBe(false);
    expect(result.instance.modules.ids).toEqual(['admin_users', 'settings']);
    expect(result.output.join('\n')).not.toContain('no `--module` was given');
  });

  it('a free module reaching a separately licensed one refuses the run and writes nothing', async () => {
    const root = mixedHost();
    addModule(root, 'mod-quotes', 'quotes', {
      manifest: `export const manifest = { id: 'quotes', dependencies: ['settings', 'erp_link'] };\n`,
    });
    await expect(runInstall(installOptions(root))).rejects.toThrow(/quotes/);
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });
});

describe('`endora new instance` keeps the smallest set (T-D3)', () => {
  it('a bare run writes the required set closed, over the same host', async () => {
    const root = mixedHost();
    const result = await runNewInstance({ dir: join(root, 'acme-shop'), cwd: root, dryRun: true });
    expect(result.modules.defaulted).toBe(true);
    expect(result.modules.ids).toEqual(['settings']);
  });

  it('D-271 clause 1.4 — from an empty directory it still refuses F6, and names `endora install`', async () => {
    const root = temp('endora-empty-');
    let thrown: unknown;
    try {
      await runNewInstance({ dir: join(root, 'acme-shop'), cwd: root, dryRun: true });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstanceHostError);
    expect((thrown as InstanceHostError).refusal).toBe('F6');
    expect((thrown as Error).message).toContain('endora install');
  });
});
