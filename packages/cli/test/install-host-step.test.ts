/**
 * `endora install` from an empty directory — the temporary host, D-271
 * (`specs/080-f4-real-scope/rulings.md`).
 *
 * ## The finding
 *
 * Run where nothing of ours is installed — the `npx` front door, whose cache is
 * above neither the target nor the working directory — the install verb exited
 * **2 with F6**: `resolveInstanceHost` looks for `node_modules/@endora-commerce`
 * above those two directories and nowhere else. Every earlier proof provisioned
 * the packages first, so none of them could see it.
 *
 * ## The ruling, as cases
 *
 * When the platform does not resolve beside the target or the working
 * directory, the install verb provisions a **host**: a fresh directory under
 * the OS temp directory, a `package.json` declaring every package of the CLI's
 * release index at its indexed version, the `.npmrc` `--registry` would write,
 * and `<runner> install` there — **before** the target is written. It then
 * resolves exactly as before with the host as the place to look. Success
 * removes the host; failure keeps it and prints its path; `--dry-run`
 * provisions and removes it and writes nothing. When the platform resolves, no
 * host step is planned and nothing changes.
 *
 * The host install runs through the verb's existing `run` seam, so a fake
 * runner materialises a fixture install where `pnpm install` would have
 * written the real one (`test/support/install-host.ts`).
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InstallHostError, runInstall, type InstallStep } from '../src/install/index.js';
import { InstanceInputError } from '../src/new-instance/host.js';
import { npmrcContent, normalizeRegistry } from '../src/new-storefront/npmrc.js';

import { ADMIN, cleanScratch, host, installFixture, temp } from './support/install-host.js';

const kept: string[] = [];
afterEach(() => {
  cleanScratch();
  while (kept.length > 0) rmSync(kept.pop()!, { recursive: true, force: true });
});

const INDEX = {
  packages: [
    { name: '@endora-commerce/cli', version: '0.14.0' },
    { name: '@endora-commerce/mod-admin-users', version: '1.2.3' },
    { name: '@endora-commerce/mod-settings', version: '1.2.3' },
    { name: '@endora-commerce/platform', version: '1.2.3' },
  ],
};

/** A release index on disk, where the install verb is told to read it. */
function indexFile(root: string, index: unknown = INDEX): string {
  const path = join(root, 'release-index.json');
  writeFileSync(path, JSON.stringify(index), 'utf8');
  return path;
}

interface Observed {
  readonly steps: InstallStep[];
  /** Whether the target existed when the host step ran. */
  targetExistedAtHostStep: boolean | null;
  hostManifest: Record<string, unknown> | null;
  hostNpmrc: string | null;
}

/**
 * A runner that materialises the fixture install where `pnpm install` would
 * have written the real one, and records what the host looked like then.
 */
function provisioningRunner(
  target: string,
  codes: Readonly<Record<string, number>> = {},
): { readonly observed: Observed; readonly run: (step: InstallStep) => Promise<number> } {
  const observed: Observed = {
    steps: [],
    targetExistedAtHostStep: null,
    hostManifest: null,
    hostNpmrc: null,
  };
  return {
    observed,
    run: async (step: InstallStep) => {
      observed.steps.push(step);
      if (step.id === 'host') {
        kept.push(step.cwd);
        observed.targetExistedAtHostStep = existsSync(target);
        observed.hostManifest = JSON.parse(
          readFileSync(join(step.cwd, 'package.json'), 'utf8'),
        ) as Record<string, unknown>;
        observed.hostNpmrc = existsSync(join(step.cwd, '.npmrc'))
          ? readFileSync(join(step.cwd, '.npmrc'), 'utf8')
          : null;
        if ((codes['host'] ?? 0) === 0) installFixture(step.cwd);
      }
      return codes[step.id] ?? 0;
    },
  };
}

function emptyOptions(
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
    releaseIndexFile: indexFile(root),
    ...ADMIN,
    ...overrides,
  } as Parameters<typeof runInstall>[0];
}

/** Every file under a directory, as text, skipping nothing. */
function everyFile(root: string): readonly { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.push({ path, text: readFileSync(path, 'utf8') });
    }
  };
  walk(root);
  return found;
}

describe('D-271 — a host is provisioned exactly when the platform does not resolve', () => {
  it('from an empty directory: the host step runs first, before any target write, then the install as before', async () => {
    const root = temp('endora-empty-');
    const target = join(root, 'acme-shop');
    const { observed, run } = provisioningRunner(target);
    const result = await runInstall(emptyOptions(root, { run }));

    expect(result.exitCode).toBe(0);
    expect(observed.steps.map((step) => step.id)).toEqual(['host', 'install', 'setup', 'admin']);
    // R5.2 — the target was not written when the host step ran.
    expect(observed.targetExistedAtHostStep).toBe(false);
    // …and the instance was written afterwards, from the host's packages.
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(result.instance.modules.ids).toEqual(['admin_users', 'settings']);

    const hostStep = observed.steps[0]!;
    // Under the OS temp directory, and neither inside nor above the target.
    expect(hostStep.cwd.startsWith(tmpdir())).toBe(true);
    expect(hostStep.cwd.startsWith(target + sep)).toBe(false);
    expect(target.startsWith(hostStep.cwd + sep)).toBe(false);
    expect(hostStep.bin).toBe('pnpm');
    expect(hostStep.argv[0]).toBe('install');
  });

  it("the host's `package.json` declares every package of the release index, at its indexed version", async () => {
    const root = temp('endora-empty-');
    const { observed, run } = provisioningRunner(join(root, 'acme-shop'));
    await runInstall(emptyOptions(root, { run }));
    expect(observed.hostManifest!['private']).toBe(true);
    expect(observed.hostManifest!['dependencies']).toEqual(
      Object.fromEntries(INDEX.packages.map((entry) => [entry.name, entry.version])),
    );
    // No `--registry`, no `.npmrc`: the machine's own configuration answers.
    expect(observed.hostNpmrc).toBeNull();
  });

  it("with `--registry`, the host's `.npmrc` is the one that flag writes, through the same writer", async () => {
    const root = temp('endora-empty-');
    const { observed, run } = provisioningRunner(join(root, 'acme-shop'));
    const registry = 'https://npm.example.com/api/npm/';
    await runInstall(emptyOptions(root, { run, registry }));
    expect(observed.hostNpmrc).toBe(npmrcContent(normalizeRegistry(registry), ['@endora-commerce']));
    // The instance writes the same file for itself, as it always did.
    expect(readFileSync(join(root, 'acme-shop', '.npmrc'), 'utf8')).toBe(observed.hostNpmrc);
  });

  it('success removes the host, says so, and leaves no path of it in the tree it wrote', async () => {
    const root = temp('endora-empty-');
    const target = join(root, 'acme-shop');
    const { observed, run } = provisioningRunner(target);
    const result = await runInstall(emptyOptions(root, { run }));
    const hostDir = observed.steps[0]!.cwd;
    expect(existsSync(hostDir)).toBe(false);
    const text = result.output.join('\n');
    // FR-156 — the step is printed like every other: its command and its host.
    expect(text).toContain(observed.steps[0]!.command);
    expect(text).toContain(hostDir);
    expect(text).toMatch(/removed/i);
    for (const file of everyFile(target)) {
      expect(file.text.includes(hostDir), `${file.path} names the temporary host`).toBe(false);
    }
  });

  it("a failed host install keeps the host, prints its path, exits with the step's own code and writes nothing", async () => {
    const root = temp('endora-empty-');
    const target = join(root, 'acme-shop');
    const { observed, run } = provisioningRunner(target, { host: 5 });
    const lines: string[] = [];
    let thrown: unknown;
    try {
      await runInstall(emptyOptions(root, { run, echo: (line: string) => lines.push(line) }));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstallHostError);
    expect((thrown as InstallHostError).exitCode).toBe(5);
    const hostDir = observed.steps[0]!.cwd;
    expect(existsSync(hostDir)).toBe(true);
    expect(`${lines.join('\n')}\n${(thrown as Error).message}`).toContain(hostDir);
    expect(existsSync(target)).toBe(false);
    expect(observed.steps.map((step) => step.id)).toEqual(['host']);
  });

  it('a refusal after the host was provisioned keeps the host too, and names it', async () => {
    const root = temp('endora-empty-');
    const { observed, run } = provisioningRunner(join(root, 'acme-shop'));
    const lines: string[] = [];
    await expect(
      runInstall(
        emptyOptions(root, {
          run,
          modules: ['not_a_module'],
          echo: (line: string) => lines.push(line),
        }),
      ),
    ).rejects.toBeInstanceOf(InstanceInputError);
    const hostDir = observed.steps[0]!.cwd;
    expect(existsSync(hostDir)).toBe(true);
    expect(lines.join('\n')).toContain(hostDir);
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });

  it('`--dry-run` provisions the host, writes nothing to the target, removes the host and says both', async () => {
    const root = temp('endora-empty-');
    const target = join(root, 'acme-shop');
    const { observed, run } = provisioningRunner(target);
    const result = await runInstall(emptyOptions(root, { run, dryRun: true }));
    expect(observed.steps.map((step) => step.id)).toEqual(['host']);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(observed.steps[0]!.cwd)).toBe(false);
    const text = result.output.join('\n');
    expect(text).toContain(observed.steps[0]!.cwd);
    expect(text).toMatch(/removed/i);
    // The module set was derived from the host — the reason the dry run needs it.
    expect(result.instance.modules.ids).toEqual(['admin_users', 'settings']);
  });

  it('when the platform resolves beside the target, no host step is planned and no index is read', async () => {
    const root = host();
    const { observed, run } = provisioningRunner(join(root, 'acme-shop'));
    const result = await runInstall(
      emptyOptions(root, { run, releaseIndexFile: join(root, 'no-such-index.json') }),
    );
    expect(result.exitCode).toBe(0);
    expect(observed.steps.map((step) => step.id)).not.toContain('host');
    expect(result.output.join('\n')).not.toMatch(/temporary host/i);
  });

  it('a CLI with no release index is an input it could not read — exit 2, nothing written', async () => {
    const root = temp('endora-empty-');
    const { observed, run } = provisioningRunner(join(root, 'acme-shop'));
    let thrown: unknown;
    try {
      await runInstall(
        emptyOptions(root, { run, releaseIndexFile: join(root, 'no-such-index.json') }),
      );
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InstallHostError);
    expect((thrown as InstallHostError).exitCode).toBe(2);
    expect((thrown as Error).message).toContain('no-such-index.json');
    expect(observed.steps).toEqual([]);
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });
});
