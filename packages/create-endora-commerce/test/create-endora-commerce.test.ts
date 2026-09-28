/**
 * `create-endora-commerce` — the npm front door, and the proof that it is only
 * a door (`specs/125-first-mile-install/` FR-141, FR-142, FR-162; tasks T6-A,
 * T6-B; `specs/136-open-source-publication/plan.md` W5.1; rulings D-267, D-268).
 *
 * ## Against the packed tarball, not the source
 *
 * What a stranger runs is what `npx` unpacks, so every case here runs the
 * package **as `pnpm pack` leaves it**: the shim's own tarball, beside the
 * CLI's own tarball, in a scratch directory laid out the way an install lays
 * them out. A test over `src/` would pass for a package whose `files` or `bin`
 * shipped nothing runnable.
 *
 * The premise that `pnpm pack` packs a `"private": true` member (D-267 keeps
 * this package private until the first npmjs publish) was re-derived rather
 * than trusted — pnpm 9.15.0 and 10.28.2 both pack one — and it stays asserted
 * here: a pack that produced no tarball fails `beforeAll`, never reads as a
 * package with nothing wrong with it.
 *
 * ## What "the same tree" is measured as
 *
 * `endora install` without `--dry-run` runs `pnpm install`, Docker and a
 * database, none of which belongs in a unit run. So T6-A compares the two
 * entry points where they can be compared exhaustively: for the same argv in
 * the same directory, the dry run's report (which names every file count and
 * every step), the refusal a run with no answers gets, and the exit code of
 * each, are byte-identical. T6-B's stub case is the other half: argv reaches
 * the CLI unchanged, so there is no input on which the two could diverge.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const CLI_DIR = join(PACKAGE_DIR, '..', 'cli');
const SHIM_SOURCE = join(PACKAGE_DIR, 'src', 'bin', 'create-endora-commerce.ts');

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly bin?: Readonly<Record<string, string>>;
  readonly files?: readonly string[];
  readonly repository?: { readonly directory?: string };
  readonly publishConfig?: { readonly access?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;

const scratch: string[] = [];
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** `pnpm pack` one workspace member into `out`; the one tarball it produced. */
function pack(memberDir: string, out: string): string {
  const before = new Set(readdirSync(out));
  const result = spawnSync('pnpm', ['pack', '--pack-destination', out], {
    cwd: memberDir,
    encoding: 'utf8',
  });
  const produced = readdirSync(out).filter((name) => !before.has(name));
  if (result.status !== 0 || produced.length !== 1) {
    throw new Error(
      `\`pnpm pack\` in ${memberDir} exited ${String(result.status)} and produced ` +
        `${String(produced.length)} tarball(s). A package that did not pack is not a package ` +
        `with nothing wrong with it.\n${result.stderr ?? ''}`,
    );
  }
  return join(out, produced[0]!);
}

/** Unpack a tarball's `package/` into `into`, which is created. */
function unpack(tarball: string, into: string): void {
  mkdirSync(into, { recursive: true });
  const result = spawnSync('tar', ['-xzf', tarball, '-C', into, '--strip-components=1'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`tar -xzf ${tarball}: ${result.stderr ?? ''}`);
}

/** One environment input, in the shape `@endora-commerce/contracts`' schema takes. */
function input(name: string, secret = false): Record<string, unknown> {
  return {
    name,
    describes: { en: `what ${name} decides.`, pl: `co ${name} ustala.` },
    requirement: { kind: 'required' },
    secret,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
  };
}

/**
 * The installed platform and one module an instance is scaffolded from — what
 * `endora install` resolves from the directory it runs in. Written as fixtures
 * rather than packed, because what is under test is the front door, and the
 * platform's own tarball is the pack gate's subject, not this file's.
 */
function hostFixture(nodeModules: string): void {
  const write = (name: string, manifest: unknown, source: string): void => {
    const dir = join(nodeModules, '@endora-commerce', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    writeFileSync(join(dir, 'manifest.js'), source, 'utf8');
  };
  write(
    'platform',
    {
      name: '@endora-commerce/platform',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'platform' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const PLATFORM_ENVIRONMENT_INPUTS = ${JSON.stringify([
      input('DATABASE_URL'),
      input('REVALIDATE_SECRET', true),
    ])};\n`,
  );
  write(
    'mod-settings',
    {
      name: '@endora-commerce/mod-settings',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'settings' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'settings', dependencies: [], activation: { nonDeactivatable: true, reason: 'x' } };\n`,
  );
}

let consumer = '';
let shimBin = '';
let cliBin = '';
let packedShim: Manifest;

beforeAll(() => {
  const tarballs = temp('136w51-tarballs-');
  consumer = temp('136w51-consumer-');
  const nodeModules = join(consumer, 'node_modules');

  const shimTarball = pack(PACKAGE_DIR, tarballs);
  const cliTarball = pack(CLI_DIR, tarballs);
  unpack(shimTarball, join(nodeModules, 'create-endora-commerce'));
  unpack(cliTarball, join(nodeModules, '@endora-commerce', 'cli'));
  // The CLI's own dependencies — `@endora-commerce/contracts` and
  // `typescript` — are not this file's subject; the workspace already has them
  // installed for the CLI, and a nested `node_modules` is where a package
  // manager would put them.
  symlinkSync(join(CLI_DIR, 'node_modules'), join(nodeModules, '@endora-commerce', 'cli', 'node_modules'));
  hostFixture(nodeModules);

  packedShim = readManifest(join(nodeModules, 'create-endora-commerce'));
  const shimEntry = packedShim.bin?.['create-endora-commerce'];
  if (shimEntry === undefined) throw new Error('the packed manifest declares no `create-endora-commerce` bin');
  shimBin = join(nodeModules, 'create-endora-commerce', shimEntry);
  const cliManifest = readManifest(join(nodeModules, '@endora-commerce', 'cli'));
  cliBin = join(nodeModules, '@endora-commerce', 'cli', cliManifest.bin!['endora']!);
});

afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function run(bin: string, argv: readonly string[], cwd: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [bin, ...argv], {
    cwd,
    encoding: 'utf8',
    // A CI marker keeps the CLI from ever asking, whichever machine runs this.
    env: { ...process.env, CI: 'true' },
  });
}

const ANSWERS = [
  '--dry-run',
  '--no-services',
  '--no-storefront',
  '--no-demo',
  '--admin-email',
  'owner@example.com',
  '--admin-password',
  'a-password-they-remember',
  '--admin-first-name',
  'Ada',
  '--admin-last-name',
  'Lovelace',
] as const;

describe('T6-A — the packed shim reaches what `endora install` reaches', () => {
  it('ships a runnable bin in its tarball', () => {
    expect(existsSync(shimBin), shimBin).toBe(true);
    expect(readFileSync(shimBin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('a dry run with every answer reports byte-for-byte what `endora install` reports', () => {
    const viaShim = run(shimBin, ['acme-shop', ...ANSWERS], consumer);
    const viaCli = run(cliBin, ['install', 'acme-shop', ...ANSWERS], consumer);
    // Non-vacuous: the run got as far as planning the instance.
    expect(viaCli.status, viaCli.stderr).toBe(0);
    expect(viaCli.stdout).toContain('would write');
    expect({ status: viaShim.status, stdout: viaShim.stdout, stderr: viaShim.stderr }).toEqual({
      status: viaCli.status,
      stdout: viaCli.stdout,
      stderr: viaCli.stderr,
    });
    expect(existsSync(join(consumer, 'acme-shop'))).toBe(false);
  });

  it('a run with no answers is refused identically, with the same exit code', () => {
    const viaShim = run(shimBin, ['acme-shop'], consumer);
    const viaCli = run(cliBin, ['install', 'acme-shop'], consumer);
    expect(viaCli.status).toBe(1);
    // D-268: the demo question is the operator's, so its refusal names both
    // answers through the shim exactly as it does without it.
    expect(viaCli.stderr).toContain('--no-demo');
    expect({ status: viaShim.status, stdout: viaShim.stdout, stderr: viaShim.stderr }).toEqual({
      status: viaCli.status,
      stdout: viaCli.stdout,
      stderr: viaCli.stderr,
    });
  });

  it('the packed manifest pins the CLI it was released with', () => {
    // `pnpm pack` rewrites `workspace:*` to the sibling's exact version, so a
    // given release of the front door always runs the CLI released with it.
    expect(packedShim.dependencies).toEqual({
      '@endora-commerce/cli': readManifest(CLI_DIR).version,
    });
  });
});

/**
 * A stand-in CLI that reports the argv it was given and exits with a code the
 * case chooses. It is resolved exactly as the real one is — by package name,
 * through its `./package.json` export and its `bin` — so the shim cannot tell
 * the difference.
 */
function stubConsumer(): string {
  const dir = temp('136w51-stub-');
  const nodeModules = join(dir, 'node_modules');
  const shimDir = join(nodeModules, 'create-endora-commerce');
  // The shim as packed — copied out of the consumer the real cases use.
  cpSync(join(consumer, 'node_modules', 'create-endora-commerce'), shimDir, { recursive: true });
  const cli = join(nodeModules, '@endora-commerce', 'cli');
  mkdirSync(cli, { recursive: true });
  writeFileSync(
    join(cli, 'package.json'),
    JSON.stringify({
      name: '@endora-commerce/cli',
      version: '9.9.9',
      type: 'module',
      bin: { endora: './stub.js' },
      exports: { './package.json': './package.json' },
    }),
    'utf8',
  );
  writeFileSync(
    join(cli, 'stub.js'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n' +
      'process.exitCode = Number(process.env.STUB_EXIT ?? 0);\n',
    'utf8',
  );
  return dir;
}

describe('T6-B — the shim implements nothing (FR-142, D-268)', () => {
  it('passes argv through verbatim, prefixed by the one verb', () => {
    const dir = stubConsumer();
    const shim = join(dir, 'node_modules', 'create-endora-commerce', packedShim.bin!['create-endora-commerce']!);
    const argv = ['my shop', '--', '-x', '', '--demo=maybe', 'zażółć', '--module', 'a,b'];
    const result = spawnSync(process.execPath, [shim, ...argv], { cwd: dir, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(['install', ...argv]);
  });

  it('adds no flag to a bare run — the demo question is not pre-answered', () => {
    const dir = stubConsumer();
    const shim = join(dir, 'node_modules', 'create-endora-commerce', packedShim.bin!['create-endora-commerce']!);
    const result = spawnSync(process.execPath, [shim], { cwd: dir, encoding: 'utf8' });
    expect(JSON.parse(result.stdout)).toEqual(['install']);
  });

  it('exits with the CLI\'s own code', () => {
    const dir = stubConsumer();
    const shim = join(dir, 'node_modules', 'create-endora-commerce', packedShim.bin!['create-endora-commerce']!);
    for (const code of [0, 1, 2, 7]) {
      const result = spawnSync(process.execPath, [shim, 'acme'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, STUB_EXIT: String(code) },
      });
      expect(result.status, `STUB_EXIT=${String(code)}`).toBe(code);
    }
  });

  it('its source names no template, no member, no module id and no install flag', () => {
    const source = readFileSync(SHIM_SOURCE, 'utf8');
    // The install question set is derived from the CLI's own usage block for
    // `endora install`, never listed here — a flag added there is refused here
    // by existing.
    const usage = readFileSync(join(CLI_DIR, 'src', 'bin', 'endora.ts'), 'utf8');
    const installUsage = /^ {2}endora install [\s\S]*?(?=^ {2}endora (?!install))/m.exec(usage)?.[0];
    expect(installUsage, 'the CLI usage block for `endora install` was not found').toBeDefined();
    const flags = [...new Set(installUsage!.match(/--[a-z][a-z-]*/g) ?? [])];
    expect(flags).toEqual(expect.arrayContaining(['--demo', '--no-demo', '--admin-email']));
    for (const flag of flags) expect(source, flag).not.toContain(flag);
    // And no double-dash token at all: a flag the usage block does not list yet
    // is still policy the shim may not hold.
    expect(source).not.toMatch(/--[a-z]/);

    for (const word of ['template', 'storefront', 'backend', 'admin', 'scaffold', 'new-instance']) {
      expect(source.toLowerCase(), word).not.toContain(word);
    }
    // Module ids, derived from the module packages' own manifests.
    const modulesRoot = join(PACKAGE_DIR, '..', 'modules');
    const ids = readdirSync(modulesRoot)
      .map((entry) => join(modulesRoot, entry, 'package.json'))
      .filter((path) => existsSync(path))
      .map((path) => (JSON.parse(readFileSync(path, 'utf8')) as { endora?: { id?: string } }).endora?.id)
      .filter((id): id is string => typeof id === 'string');
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      expect(source, `module id \`${id}\``).not.toMatch(new RegExp(`\\b${id}\\b`));
    }
  });

  it('depends on the CLI and on nothing else', () => {
    const manifest = readManifest(PACKAGE_DIR);
    expect(manifest.dependencies).toEqual({ '@endora-commerce/cli': 'workspace:*' });
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });
});

describe('T6-C — a publishable package like every other, private until npmjs (D-267)', () => {
  it('carries everything a public package owes, so publishing it is one field', () => {
    const manifest = readManifest(PACKAGE_DIR);
    expect(manifest.name).toBe('create-endora-commerce');
    expect(manifest.private).toBe(true);
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository?.directory).toBe('packages/create-endora-commerce');
    expect(manifest.publishConfig?.access).toBe('public');
    expect(manifest.files).toEqual(['dist']);
    expect(existsSync(join(PACKAGE_DIR, 'LICENSE'))).toBe(true);
    expect(existsSync(join(PACKAGE_DIR, 'README.md'))).toBe(true);
    // npmjs holds `0.0.1` of this name as the owner's placeholder (D-267), so
    // that number can never be published again.
    expect(manifest.version).not.toBe('0.0.1');
  });

  it('packs its licence and its README beside the bin', () => {
    const packed = join(consumer, 'node_modules', 'create-endora-commerce');
    expect(existsSync(join(packed, 'LICENSE'))).toBe(true);
    expect(existsSync(join(packed, 'README.md'))).toBe(true);
  });
});
