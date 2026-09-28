/**
 * The `local-registry` acceptance mode — the front door, proven before anything
 * is published (`specs/080-f4-real-scope/rulings.md` D-271 clause 4; 136 plan
 * W5.1).
 *
 * ## What it does
 *
 * It packs every publishable package of this checkout, and the
 * `create-endora-commerce` front door beside them, and serves the tarballs from
 * a registry on `node:http` (`local-registry.ts`) that forwards every other
 * name to npmjs. Then, from an empty directory with no workspace, no git and no
 * `node_modules` above it, with `npm_config_registry` pointed at that registry
 * and `npm_config_cache` at a scratch directory, it types what a stranger types:
 *
 *   `npx --yes create-endora-commerce@<v> shop --non-interactive …`
 *
 * and judges whether the run got past resolution, installed, and left an
 * administrator who can sign in.
 *
 * ## Why it exists beside `tarball`, `registry` and `public`
 *
 * It is the only mode that **provisions nothing itself**. `instance.ts`
 * installs every package into a host and runs the CLI from there, so the CLI
 * always finds what it needs beside it; that is exactly why none of those
 * proofs saw the install verb exit 2 with F6 from an empty directory (D-270
 * clause 5). Here the shim and the CLI land in a real npx cache, and whatever
 * else the run reads it has to fetch for itself — which since D-271 is the
 * install verb's own temporary host.
 *
 * ## What it asks of the machine
 *
 * `ACCEPTANCE_DATABASE_URL` naming a **disposable** database (the name must
 * contain `test`; it is dropped and re-created) and `REDIS_URL`, both explicit —
 * there is no default, because the default would be somebody's development
 * database. The instance's development services are not started
 * (`--no-services`): the addresses go into the target's `.env` before the run,
 * the one file a stranger may place there, so the run never binds the ports a
 * development stack on the same machine already holds. `pnpm run
 * build:packages` must have run.
 *
 * Usage: `pnpm --filter backend exec tsx scripts/acceptance/instance-local-registry.ts
 * [--package create-endora-commerce] [--keep]`. Exit **0** met, **1** measured
 * and red, **2** could not be measured.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { publishablePackages } from '@endora-commerce/cli/lib/release-index.js';
import { nodeWorkspaceFs, workspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { resolveDatabaseTarget } from './assertions.js';
import { instanceEnvValues } from './instance-assertions.js';
import { startLocalRegistry, tarballFrom, type LocalRegistry } from './local-registry.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
const UPSTREAM = 'https://registry.npmjs.org';
const HEALTH_PATH = '/api/v1/_health';
const LOGIN_PATH = '/api/v1/auth/admin/login';
const INSTALL_TIMEOUT_MS = 60 * 60_000;
const BOOT_TIMEOUT_MS = 5 * 60_000;
/** The prefix `endora install` gives its temporary host (`packages/cli/src/install/host.ts`). */
const HOST_PREFIX = 'endora-install-host-';

interface Verdict {
  readonly id: string;
  readonly title: string;
  readonly status: 'pass' | 'fail' | 'unmeasured';
  readonly detail: string;
}

function refuse(message: string): never {
  console.error(`[instance-acceptance:local-registry] cannot measure: ${message}`);
  console.error('[instance-acceptance:local-registry] exit 2 — neither a pass nor a failure.');
  process.exit(2);
}

/** A workspace, a git repository, a manifest or an install above `dir`. */
function contextAbove(dir: string): string | null {
  for (let current = resolve(dir); ; current = dirname(current)) {
    for (const marker of ['pnpm-workspace.yaml', '.git', 'package.json', 'node_modules']) {
      if (existsSync(join(current, marker))) return join(current, marker);
    }
    if (dirname(current) === current) return null;
  }
}

/** A free loopback port for the instance's API. */
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address !== null ? resolvePort(address.port) : reject(new Error('no port')),
      );
    });
  });
}

/**
 * This process's environment with every package-manager setting removed.
 *
 * Run through `pnpm`, a script inherits `npm_config_*` from it — the registry
 * among them — and a stranger's shell has none of those. What is added back is
 * this run's own: the registry, a user configuration with nothing in it, and a
 * scratch npm cache, so the front door and the CLI land in an npx cache of
 * their own. pnpm's metadata cache is keyed by registry, and this registry's
 * port is new on every run.
 */
function strangerEnvironment(registry: string, scratch: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(npm_|pnpm_)/i.test(name)),
  );
  const userconfig = join(scratch, 'npmrc');
  writeFileSync(userconfig, '', 'utf8');
  return {
    ...clean,
    npm_config_registry: `${registry}/`,
    npm_config_userconfig: userconfig,
    npm_config_cache: join(scratch, 'npm-cache'),
    npm_config_update_notifier: 'false',
  };
}

/** Run a command with output streamed and its tail kept. Never a shell. */
function exec(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; shown?: string },
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult) => {
    console.log(`\n$ ${options.shown ?? [command, ...args].join(' ')}`);
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output = `${output}${text}`.slice(-400_000);
      process.stdout.write(text);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveResult({ code: 127, output: `${output}\n${error.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? (signal === null ? 1 : 128), output });
    });
  });
}

/** Pack one package directory into `destination`, answering the tarball's path. */
function pack(dir: string, destination: string): string {
  const before = new Set(readdirSync(destination));
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (result.status !== 0) refuse(`\`pnpm pack\` failed in ${dir}:\n${result.stdout}${result.stderr}`);
  const written = readdirSync(destination).filter((entry) => entry.endsWith('.tgz') && !before.has(entry));
  if (written.length !== 1) refuse(`\`pnpm pack\` in ${dir} wrote ${String(written.length)} tarballs, expected one`);
  return join(destination, written[0]!);
}

async function resetDatabase(adminUrl: string, name: string, drop: boolean): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error: unknown) {
    if (!drop) return;
    refuse(`PostgreSQL is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    if (drop) await client.query(`create database "${name}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function waitFor(url: string, deadline: number, child: ChildProcess): Promise<number | null> {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return response.status;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  }
  return null;
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((done) => child.once('close', () => done()));
  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {
    return;
  }
  const timeout = new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), 30_000));
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
}

/** Temporary hosts `endora install` left in the temp directory since `since`. */
function hostsLeftBehind(since: number): readonly string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith(HOST_PREFIX))
    .map((entry) => join(tmpdir(), entry))
    .filter((path) => {
      try {
        return statSync(path).mtimeMs >= since;
      } catch {
        return false;
      }
    });
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { package: { type: 'string' }, keep: { type: 'boolean' } },
  });
  const packageName = (values.package ?? 'create-endora-commerce').trim();
  const dsn = (process.env['ACCEPTANCE_DATABASE_URL'] ?? '').trim();
  if (dsn.length === 0) {
    refuse('ACCEPTANCE_DATABASE_URL is required and has no default: the database it names is dropped.');
  }
  const database = resolveDatabaseTarget(dsn);
  if ('error' in database) refuse(database.error);
  const redisUrl = (process.env['REDIS_URL'] ?? '').trim();
  if (redisUrl.length === 0) refuse('REDIS_URL is required and has no default.');

  // ── pack ────────────────────────────────────────────────────────────────
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'endora-local-registry-')));
  const above = contextAbove(scratch);
  if (above !== null) {
    rmSync(scratch, { recursive: true, force: true });
    refuse(`${above} is above ${scratch}. A stranger's directory has nothing of ours above it.`);
  }
  const tarballDir = join(scratch, 'tarballs');
  mkdirSync(tarballDir);
  const packages = publishablePackages(join(REPO_ROOT, 'packages'));
  const frontDoor = workspaceMembers(REPO_ROOT, nodeWorkspaceFs()).find((member) => member.name === packageName);
  if (frontDoor === undefined) refuse(`no workspace package is named ${packageName}`);
  const toPack = [...packages.map((pkg) => pkg.dir), ...(packages.some((pkg) => pkg.name === packageName) ? [] : [frontDoor.dir])];
  for (const dir of toPack) {
    if (!existsSync(join(dir, 'dist'))) refuse(`${dir} has no dist — run \`pnpm run build:packages\` first`);
  }
  if (!existsSync(join(REPO_ROOT, 'packages', 'cli', 'dist', 'release-index.json'))) {
    refuse('packages/cli/dist/release-index.json is absent — run `pnpm run build:packages` first');
  }
  console.log(`[instance-acceptance:local-registry] packing ${String(toPack.length)} packages into ${tarballDir}`);
  const tarballs = toPack.map((dir) => {
    const file = pack(dir, tarballDir);
    return tarballFrom(file, readFileSync(file));
  });
  const frontDoorTarball = tarballs.find((tarball) => tarball.name === packageName)!;

  // ── serve, and type what a stranger types ──────────────────────────────
  let registry: LocalRegistry | null = null;
  let api: ChildProcess | null = null;
  const verdicts: Verdict[] = [];
  const notes: string[] = [];
  const started = Date.now();
  try {
    registry = await startLocalRegistry({ tarballs, upstream: UPSTREAM });
    notes.push(`registry ${registry.url}: ${String(tarballs.length)} local tarballs, everything else from ${UPSTREAM}`);
    await resetDatabase(database.adminUrl, database.databaseName, true);

    const work = join(scratch, 'work');
    const target = join(work, 'shop');
    mkdirSync(target, { recursive: true });
    const port = await freePort();
    const admin = {
      email: 'owner@example.com',
      password: randomBytes(18).toString('base64url'),
      firstName: 'Local',
      lastName: 'Registry',
    };
    // The one file a stranger may place in the target before the run: their
    // own answers. `--no-services` means these are the services they run.
    // `REVALIDATE_SECRET` is deliberately not among them: under
    // `--no-storefront` nothing generates it (`input-resolution.md` R4.6
    // permits that only to a run writing both trees), and this run proves the
    // instance boots and signs an administrator in without it.
    const answers = {
      ...instanceEnvValues({ databaseUrl: database.databaseUrl, env: { ...process.env, REDIS_URL: redisUrl } }),
      PORT: String(port),
    };
    writeFileSync(
      join(target, '.env'),
      `${Object.entries(answers).map(([name, value]) => `${name}=${value}`).join('\n')}\n`,
      'utf8',
    );
    const environment = strangerEnvironment(registry.url, scratch);
    const argv = [
      '--yes',
      `${packageName}@${frontDoorTarball.version}`,
      'shop',
      '--non-interactive',
      '--no-storefront',
      '--no-services',
      '--no-demo',
      '--admin-email',
      admin.email,
      '--admin-password',
      admin.password,
      '--admin-first-name',
      admin.firstName,
      '--admin-last-name',
      admin.lastName,
    ];
    const install = await exec('npx', argv, {
      cwd: work,
      env: environment,
      timeoutMs: INSTALL_TIMEOUT_MS,
      shown: `npx --yes ${packageName}@${frontDoorTarball.version} shop --non-interactive --no-storefront --no-services --no-demo --admin-email ${admin.email} --admin-password … --admin-first-name ${admin.firstName} --admin-last-name ${admin.lastName}`,
    });
    const tail = install.output.trim().split('\n').slice(-12).join(' | ');

    verdicts.push({
      id: 'L1',
      title: 'the one-shot, typed from an empty directory, exits 0',
      status: install.code === 0 ? 'pass' : 'fail',
      detail: install.code === 0 ? 'exit 0' : `exit ${String(install.code)}: ${tail}`,
    });
    const provisioned = /^\[host\] /m.test(install.output);
    verdicts.push({
      id: 'L2',
      title: 'it got past resolution by provisioning its own temporary host (D-271)',
      status: provisioned && !/F6|does not resolve from/.test(install.output) ? 'pass' : 'fail',
      detail: provisioned ? 'the host step ran' : 'no host step was printed',
    });
    const needed = [packageName, '@endora-commerce/cli', '@endora-commerce/platform'];
    const missing = needed.filter((name) => !registry!.served.includes(name));
    verdicts.push({
      id: 'L3',
      title: 'the front door, the CLI and the platform came from this registry',
      status: missing.length === 0 ? 'pass' : 'fail',
      detail:
        missing.length === 0
          ? `${String(registry.served.length)} local packuments served, ${String(registry.forwarded())} requests forwarded`
          : `never requested: ${missing.join(', ')}`,
    });
    const manifestPath = join(target, 'package.json');
    const declared = existsSync(manifestPath)
      ? Object.keys(
          (JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {},
        ).filter((name) => name.startsWith('@endora-commerce/mod-'))
      : [];
    verdicts.push({
      id: 'L4',
      title: 'with no --module it declared the open-source set and said so (D-270)',
      status: install.output.includes('no `--module` was given') && declared.length > 0 ? 'pass' : install.code === 0 ? 'fail' : 'unmeasured',
      detail: `${String(declared.length)} module packages declared`,
    });
    const left = hostsLeftBehind(started);
    verdicts.push({
      id: 'L5',
      title: 'the temporary host is gone after a successful run',
      status: install.code !== 0 ? 'unmeasured' : left.length === 0 ? 'pass' : 'fail',
      detail: left.length === 0 ? 'none left' : `left behind: ${left.join(', ')}`,
    });

    // ── an administrator signs in ────────────────────────────────────────
    let login: Verdict = {
      id: 'L6',
      title: 'an administrator signs in to the running instance',
      status: 'unmeasured',
      detail: 'the one-shot did not succeed',
    };
    if (install.code === 0) {
      console.log('\n$ pnpm run start');
      api = spawn('pnpm', ['run', 'start'], {
        cwd: target,
        env: environment,
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
      });
      const health = await waitFor(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`, Date.now() + BOOT_TIMEOUT_MS, api);
      if (health === null) {
        login = { ...login, status: 'fail', detail: api.exitCode === null ? 'the API did not answer in time' : `start exited ${String(api.exitCode)}` };
      } else {
        const reply = await fetch(`http://127.0.0.1:${String(port)}${LOGIN_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: admin.email, password: admin.password }),
          signal: AbortSignal.timeout(20_000),
        });
        login = {
          ...login,
          status: reply.status === 200 ? 'pass' : 'fail',
          detail: `health ${String(health)}, login ${String(reply.status)}${reply.status === 200 ? '' : `: ${(await reply.text()).slice(0, 300)}`}`,
        };
      }
    }
    verdicts.push(login);
  } finally {
    if (api !== null) await stopGroup(api);
    if (registry !== null) await registry.close();
    await resetDatabase(database.adminUrl, database.databaseName, false).catch(() => undefined);
    if (values.keep === true) notes.push(`kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }

  console.log('\n[instance-acceptance:local-registry] report');
  for (const note of notes) console.log(`  note: ${note}`);
  for (const verdict of verdicts) {
    console.log(`  ${verdict.id} ${verdict.status.toUpperCase().padEnd(10)} ${verdict.title} — ${verdict.detail}`);
  }
  return verdicts.some((verdict) => verdict.status === 'fail') ? 1 : verdicts.some((verdict) => verdict.status === 'unmeasured') ? 2 : 0;
}

process.exitCode = await main();
