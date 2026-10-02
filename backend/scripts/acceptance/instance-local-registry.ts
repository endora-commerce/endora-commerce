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
 * administrator who can sign in. Then it does what a client does next: it runs
 * `endora new module` inside the instance, installs the overlay module that
 * wrote, and asks its route — with no file of the instance edited by hand, so
 * an answer is the instance composing its own `apps/<deployment>/`.
 *
 * And then whether that administrator, and the
 * operator at the terminal beside them, can do what Principle XVII promises an
 * instance: list the modules, switch one off and have it stay off across a
 * restart, and take one out with `module:disable` / `module:uninstall` and put
 * it back (L11–L16, L18). Those seven are here because this is the only composition
 * that is an instance's — `composeApp` with no contribution and the five
 * `module:*` entry points as `endora new instance` renders them — and both
 * defects they were written from were invisible everywhere else: the reference
 * deployment contributed the orchestrator itself, and every fixture handed the
 * orchestrator one shared `EntityManager`.
 *
 * And, since the CLI carries the reference storefront
 * (`packages/cli/src/new-storefront/packaged.ts`), it judges whether the
 * **storefront** the one-shot wrote beside the instance installs, builds,
 * starts and renders a demo product against that instance's API. That last
 * part is `public` mode's P2, measured here before anything is published: the
 * one-shot is typed with `--demo` and **without** `--no-storefront`, from a
 * directory with no checkout above it.
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
 * One of two things, and the choice is the caller's:
 *
 *   * **default** — `ACCEPTANCE_DATABASE_URL` naming a **disposable** database
 *     (the name must contain `test`; it is dropped and re-created) and
 *     `REDIS_URL`, both explicit: there is no default, because the default
 *     would be somebody's development database. The instance's development
 *     services are not started (`--no-services`); the addresses go into the
 *     target's `.env` before the run, the one file a stranger may place there.
 *   * **`--services`** — nothing but a Docker daemon. The one-shot starts its
 *     own development stack, exactly as a stranger's run does, on whichever
 *     host ports are free (`endora install` moves a taken one and says so), in
 *     a Compose project named after a directory unique to this run; the stack
 *     is taken down with its volumes afterwards.
 *
 * `pnpm run build:packages` must have run, in a git checkout: the CLI's build
 * is what packages the reference storefront.
 *
 * Usage: `pnpm --filter backend exec tsx scripts/acceptance/instance-local-registry.ts
 * [--package create-endora-commerce] [--services] [--no-storefront] [--keep]`.
 * Exit **0** met, **1** measured and red, **2** could not be measured.
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
const STOREFRONT_BUILD_TIMEOUT_MS = 20 * 60_000;
const STEP_TIMEOUT_MS = 10 * 60_000;
/** The overlay module the run scaffolds into the instance it created. */
const OVERLAY_MODULE_ID = 'proof_notice';
const MODULES_PATH = '/api/v1/admin/modules';
const PRESENCE_PATH = '/api/v1/admin/module-presence';
/**
 * How long a running process may take to hear of a change another process
 * made. The pub/sub round trip is milliseconds; this is the ceiling, and it is
 * well above the cache's own degraded-mode re-read so a lost notification still
 * measures green for the right reason rather than red for a slow machine.
 */
const PROPAGATION_TIMEOUT_MS = 30_000;
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

interface PresenceRow {
  readonly id: string;
  readonly present: boolean;
  readonly platformState: string;
  readonly activated: boolean;
  readonly deactivatable: boolean;
}

/** Sign in and answer the session as a `cookie` header value, or the failure. */
async function signIn(
  origin: string,
  admin: { email: string; password: string },
): Promise<{ status: number; cookie: string; body: string }> {
  const reply = await fetch(`${origin}${LOGIN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
    signal: AbortSignal.timeout(20_000),
  });
  const cookie = reply.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  return { status: reply.status, cookie, body: reply.status === 200 ? '' : (await reply.text()).slice(0, 300) };
}

async function adminRequest(
  origin: string,
  cookie: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  const reply = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await reply.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON — the status and the text are the answer
  }
  return { status: reply.status, json, text: text.slice(0, 300) };
}

async function presenceOf(origin: string, cookie: string, id: string): Promise<PresenceRow | null> {
  const reply = await adminRequest(origin, cookie, PRESENCE_PATH);
  const modules = (reply.json as { modules?: PresenceRow[] } | null)?.modules ?? [];
  return modules.find((entry) => entry.id === id) ?? null;
}

/** Poll the running process's presence projection until `accept` holds. */
async function presenceBecomes(
  origin: string,
  cookie: string,
  id: string,
  accept: (row: PresenceRow | null) => boolean,
): Promise<PresenceRow | null> {
  const deadline = Date.now() + PROPAGATION_TIMEOUT_MS;
  let last: PresenceRow | null = null;
  for (;;) {
    last = await presenceOf(origin, cookie, id);
    if (accept(last) || Date.now() >= deadline) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
}

/**
 * The temporary hosts **this run's** one-shot provisioned that are still there.
 *
 * Read off the one-shot's own `[host] … # in <path>` line rather than by
 * scanning the temp directory for anything recent: the temp directory is shared,
 * and a second acceptance run on the same machine has a host of its own there
 * for minutes at a time. Scanned, that host was reported as this run's leftover
 * — measured, with this run's own host named as removed in the same output.
 */
function hostsLeftBehind(output: string): readonly string[] {
  return [...output.matchAll(/^\[host\] .*# in (\S+)\s*$/gm)]
    .map((match) => match[1]!)
    .filter((path) => path.includes(HOST_PREFIX) && existsSync(path));
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      keep: { type: 'boolean' },
      services: { type: 'boolean' },
      'no-storefront': { type: 'boolean' },
    },
  });
  const packageName = (values.package ?? 'create-endora-commerce').trim();
  const withServices = values.services === true;
  const withStorefront = values['no-storefront'] !== true;
  let database: { adminUrl: string; databaseName: string; databaseUrl: string } | null = null;
  let redisUrl = '';
  if (withServices) {
    if (spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status !== 0) {
      refuse('--services was given and no Docker daemon answered.');
    }
  } else {
    const dsn = (process.env['ACCEPTANCE_DATABASE_URL'] ?? '').trim();
    if (dsn.length === 0) {
      refuse(
        'ACCEPTANCE_DATABASE_URL is required and has no default: the database it names is dropped. ' +
          'Pass --services to let the one-shot start its own development stack instead.',
      );
    }
    const resolved = resolveDatabaseTarget(dsn);
    if ('error' in resolved) refuse(resolved.error);
    database = resolved;
    redisUrl = (process.env['REDIS_URL'] ?? '').trim();
    if (redisUrl.length === 0) refuse('REDIS_URL is required and has no default.');
  }

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
  if (
    withStorefront &&
    !existsSync(join(REPO_ROOT, 'packages', 'cli', 'dist', 'storefront-reference', 'reference.json'))
  ) {
    refuse(
      'packages/cli/dist/storefront-reference/reference.json is absent — the CLI build writes it ' +
        'from a git checkout that holds the storefront; run `pnpm run build:packages` in one',
    );
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
  let shop: ChildProcess | null = null;
  // Unique to this run: with `--services` the directory's name is the Compose
  // project's, and two runs on one machine must not share containers.
  const dirName = withServices ? `shop-${randomBytes(3).toString('hex')}` : 'shop';
  let target = '';
  const verdicts: Verdict[] = [];
  const notes: string[] = [];
  try {
    registry = await startLocalRegistry({ tarballs, upstream: UPSTREAM });
    notes.push(`registry ${registry.url}: ${String(tarballs.length)} local tarballs, everything else from ${UPSTREAM}`);
    if (database !== null) await resetDatabase(database.adminUrl, database.databaseName, true);

    const work = join(scratch, 'work');
    target = join(work, dirName);
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
    // With `--services` the only line is the API's port: every address is
    // derived by the one-shot from the stack it starts.
    const answers: Record<string, string> = {
      ...(database === null
        ? {}
        : instanceEnvValues({ databaseUrl: database.databaseUrl, env: { ...process.env, REDIS_URL: redisUrl } })),
      PORT: String(port),
    };
    writeFileSync(
      join(target, '.env'),
      `${Object.entries(answers).map(([name, value]) => `${name}=${value}`).join('\n')}\n`,
      'utf8',
    );
    const environment = strangerEnvironment(registry.url, scratch);
    const choices = [
      ...(withStorefront ? [] : ['--no-storefront']),
      ...(withServices ? [] : ['--no-services']),
      // A storefront with nothing in its catalogue proves nothing about it.
      withStorefront ? '--demo' : '--no-demo',
    ];
    const argv = [
      '--yes',
      `${packageName}@${frontDoorTarball.version}`,
      dirName,
      '--non-interactive',
      ...choices,
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
      shown: `npx --yes ${packageName}@${frontDoorTarball.version} ${dirName} --non-interactive ${choices.join(' ')} --admin-email ${admin.email} --admin-password … --admin-first-name ${admin.firstName} --admin-last-name ${admin.lastName}`,
    });
    const tail = install.output.trim().split('\n').slice(-12).join(' | ');

    verdicts.push({
      id: 'L1',
      title: 'the one-shot, typed from an empty directory, exits 0',
      status: install.code === 0 ? 'pass' : 'fail',
      detail: install.code === 0 ? 'exit 0' : `exit ${String(install.code)}: ${tail}`,
    });
    const provisioned = /^\[host\] /m.test(install.output);
    // The refusal as the CLI prints it — `endora: [F6] …`. A bare `F6` also
    // matches a content hash in the admin build's output, and did: the chunk
    // `AttributesManager-C6DF6Wi7.js` turned this verdict red on a green run.
    verdicts.push({
      id: 'L2',
      title: 'it got past resolution by provisioning its own temporary host (D-271)',
      status: provisioned && !/\[F6\]|does not resolve from/.test(install.output) ? 'pass' : 'fail',
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
    const left = hostsLeftBehind(install.output);
    verdicts.push({
      id: 'L5',
      title: 'the temporary host is gone after a successful run',
      status: install.code !== 0 ? 'unmeasured' : left.length === 0 ? 'pass' : 'fail',
      detail: left.length === 0 ? 'none left' : `left behind: ${left.join(', ')}`,
    });

    // ── the client extends it: an overlay module, with no hand edit ──────
    //
    // The tree is exactly as the one-shot left it: nothing below edits `.env`
    // or `package.json`. So a route that answers is the instance composing its
    // own `apps/<deployment>/` (the run wrote `DEPLOYMENT`), resolving the
    // contracts package a manifest imports (the run declared it), and
    // `endora new module` working where a client stands.
    const overlayRan = install.code === 0;
    const scaffold = overlayRan
      ? await exec(
          'pnpm',
          [
            'exec',
            'endora',
            'new',
            'module',
            OVERLAY_MODULE_ID,
            '--name',
            'Proof notice',
            '--description',
            'An overlay module written by the acceptance run.',
            '--permission',
            `${OVERLAY_MODULE_ID}:read=View the proof notice`,
          ],
          { cwd: target, env: environment, timeoutMs: STEP_TIMEOUT_MS },
        )
      : null;
    verdicts.push({
      id: 'L7',
      title: '`endora new module`, run inside the instance, writes an overlay module',
      status: scaffold === null ? 'unmeasured' : scaffold.code === 0 ? 'pass' : 'fail',
      detail:
        scaffold === null
          ? 'the one-shot did not succeed'
          : scaffold.code === 0
            ? `apps/${dirName}/modules/${OVERLAY_MODULE_ID} written`
            : `exit ${String(scaffold.code)}: ${scaffold.output.trim().split('\n').slice(-6).join(' | ')}`,
    });
    const overlayInstalled =
      scaffold?.code === 0
        ? await exec('pnpm', ['run', 'module:install', OVERLAY_MODULE_ID], {
            cwd: target,
            env: environment,
            timeoutMs: STEP_TIMEOUT_MS,
          })
        : null;
    const overlayGenerated =
      overlayInstalled?.code === 0
        ? await exec('pnpm', ['run', 'generate'], { cwd: target, env: environment, timeoutMs: STEP_TIMEOUT_MS })
        : null;
    verdicts.push({
      id: 'L8',
      title: 'the instance installs it and `generate` is clean over it',
      status:
        overlayInstalled === null
          ? 'unmeasured'
          : overlayInstalled.code === 0 && overlayGenerated?.code === 0
            ? 'pass'
            : 'fail',
      detail:
        overlayInstalled === null
          ? 'no overlay module was written'
          : `module:install exit ${String(overlayInstalled.code)}, generate exit ${String(overlayGenerated?.code ?? 'not run')}`,
    });

    // An overlay module that ships schema is refused by name, not ignored.
    // Written and removed before the boot, so the instance that starts below
    // is the one a client has.
    let schemaRefusal: Verdict = {
      id: 'L9',
      title: 'an overlay module with a `migrations/` directory is refused, with a remedy',
      status: 'unmeasured',
      detail: 'no overlay module was written',
    };
    let bootRefusal: Verdict = {
      id: 'L17',
      title: 'the same tree is refused by the API and by a `module:*` command, with no `generate` run',
      status: 'unmeasured',
      detail: 'no overlay module was written',
    };
    if (overlayGenerated?.code === 0) {
      const migrations = join(target, 'apps', dirName, 'modules', OVERLAY_MODULE_ID, 'migrations');
      mkdirSync(migrations, { recursive: true });
      writeFileSync(join(migrations, 'Migration20270101T000000_proof.ts'), 'export {};\n', 'utf8');
      const refused = await exec('pnpm', ['run', 'generate'], { cwd: target, env: environment, timeoutMs: STEP_TIMEOUT_MS });
      // The same tree, met by the two processes that never run `generate`: the
      // API and a `module:*` command. Each must stop before it composes or
      // opens anything — an API that came up here would be killed by the
      // timeout and reported as the failure it is.
      const booted = await exec('pnpm', ['run', 'start'], { cwd: target, env: environment, timeoutMs: 120_000 });
      const commanded = await exec('pnpm', ['run', 'module:status', OVERLAY_MODULE_ID], {
        cwd: target,
        env: environment,
        timeoutMs: STEP_TIMEOUT_MS,
      });
      rmSync(migrations, { recursive: true, force: true });
      const refusedAtBoot = (run: { code: number; output: string }): boolean =>
        run.code !== 0 &&
        run.output.includes(join('apps', 'shop', 'modules', OVERLAY_MODULE_ID, 'migrations', 'Migration20270101T000000_proof.ts')) &&
        run.output.includes('contributes no schema');
      bootRefusal = {
        ...bootRefusal,
        status: refusedAtBoot(booted) && refusedAtBoot(commanded) ? 'pass' : 'fail',
        detail: `start exit ${String(booted.code)}, module:status exit ${String(commanded.code)}, ${
          refusedAtBoot(booted) && refusedAtBoot(commanded) ? 'both naming the file' : 'not both naming the file'
        }`,
      };
      const named =
        refused.output.includes(`apps/${dirName}/modules/${OVERLAY_MODULE_ID}/migrations/Migration20270101T000000_proof.ts`) &&
        refused.output.includes('module package');
      schemaRefusal = {
        ...schemaRefusal,
        status: refused.code !== 0 && named ? 'pass' : 'fail',
        detail: `generate exit ${String(refused.code)}, ${named ? 'naming the file and the remedy' : 'without naming the file and the remedy'}`,
      };
    }
    verdicts.push(schemaRefusal);
    verdicts.push(bootRefusal);

    // ── an administrator signs in ────────────────────────────────────────
    let login: Verdict = {
      id: 'L6',
      title: 'an administrator signs in to the running instance',
      status: 'unmeasured',
      detail: 'the one-shot did not succeed',
    };
    const lifecycle: Verdict[] = [
      ['L11', 'the module list answers 200 with this instance\'s modules'],
      ['L12', 'an activation switched off through the API is still off after a restart, and comes back'],
      ['L13', '`module:disable` is persisted: a fresh process reads `disabled`'],
      ['L14', 'the running API hears `module:disable` from the terminal without a restart'],
      ['L15', '`module:enable` restores it, in the registry and in the running API'],
      ['L16', 'a soft `module:uninstall` is persisted, and `module:install` restores it'],
      ['L18', '`module:uninstall --hard` needs `--force`, then reverts and removes, and `migrate` + `module:install` restore it'],
    ].map(([id, title]) => ({ id: id!, title: title!, status: 'unmeasured', detail: 'not reached' }));
    const settle = (id: string, pass: boolean, detail: string): void => {
      const index = lifecycle.findIndex((verdict) => verdict.id === id);
      lifecycle[index] = { ...lifecycle[index]!, status: pass ? 'pass' : 'fail', detail };
    };
    if (install.code === 0) {
      const origin = `http://127.0.0.1:${String(port)}`;
      const boot = async (): Promise<number | null> => {
        console.log('\n$ pnpm run start');
        api = spawn('pnpm', ['run', 'start'], {
          cwd: target,
          env: environment,
          stdio: ['ignore', 'inherit', 'inherit'],
          detached: true,
        });
        return waitFor(`${origin}${HEALTH_PATH}`, Date.now() + BOOT_TIMEOUT_MS, api);
      };
      const health = await boot();
      if (health === null) {
        const exitCode = (api as ChildProcess | null)?.exitCode ?? null;
        login = { ...login, status: 'fail', detail: exitCode === null ? 'the API did not answer in time' : `start exited ${String(exitCode)}` };
      } else {
        let session = await signIn(origin, admin);
        login = {
          ...login,
          status: session.status === 200 ? 'pass' : 'fail',
          detail: `health ${String(health)}, login ${String(session.status)}${session.status === 200 ? '' : `: ${session.body}`}`,
        };

        if (session.status === 200) {
          // ── L11: the list the Modules screen renders ──────────────────────
          const list = await adminRequest(origin, session.cookie, MODULES_PATH);
          const listed = (list.json as { modules?: { id: string; state: string }[] } | null)?.modules ?? [];
          settle(
            'L11',
            list.status === 200 && listed.length > 0,
            list.status === 200 ? `200, ${String(listed.length)} modules` : `${String(list.status)}: ${list.text}`,
          );

          // ── L12: the operator axis, across a restart ──────────────────────
          // The subject is whichever deactivatable module the platform lets go
          // first: one with a present dependent is refused, and which modules
          // those are is the manifests' business rather than this file's.
          const presence = await adminRequest(origin, session.cookie, PRESENCE_PATH);
          const candidates = ((presence.json as { modules?: PresenceRow[] } | null)?.modules ?? [])
            .filter((entry) => entry.deactivatable && entry.present)
            .map((entry) => entry.id);
          let subject: string | null = null;
          let refusal = `no deactivatable module among ${String(candidates.length)} candidates`;
          for (const id of candidates) {
            const off = await adminRequest(origin, session.cookie, `${MODULES_PATH}/${id}/activation`, { active: false });
            if (off.status === 200) {
              subject = id;
              break;
            }
            refusal = `${id}: ${String(off.status)} ${off.text}`;
          }
          if (subject === null) {
            settle('L12', false, `nothing could be switched off — last refusal ${refusal}`);
          } else {
            await stopGroup(api!);
            const again = await boot();
            session = again === null ? session : await signIn(origin, admin);
            const afterRestart = again === null ? null : await presenceOf(origin, session.cookie, subject);
            const on = await adminRequest(origin, session.cookie, `${MODULES_PATH}/${subject}/activation`, { active: true });
            const restored = await presenceOf(origin, session.cookie, subject);
            settle(
              'L12',
              afterRestart !== null && !afterRestart.activated && !afterRestart.present && on.status === 200 && restored?.present === true,
              `${subject}: after restart activated=${String(afterRestart?.activated)} present=${String(afterRestart?.present)}; ` +
                `switched on again ${String(on.status)}, present=${String(restored?.present)}`,
            );

            // ── L13–L16: the platform axis, from the terminal ────────────────
            // Each command is a process of its own, and so is each reading of
            // the registry: what `module:status` prints is what the *next*
            // process finds in `module_registrations`, which is the question.
            const operator = (script: string, ...args: string[]): Promise<{ code: number; output: string }> =>
              exec('pnpm', ['run', script, ...args], { cwd: target, env: environment, timeoutMs: BOOT_TIMEOUT_MS });
            const registryState = async (): Promise<string> => {
              const status = await operator('module:status', subject!, '--json');
              return /"state":\s*"([a-z-]+)"/.exec(status.output)?.[1] ?? `unreadable (exit ${String(status.code)})`;
            };

            const disable = await operator('module:disable', subject);
            const disabled = await registryState();
            settle('L13', disable.code === 0 && disabled === 'disabled', `${subject}: exit ${String(disable.code)}, a fresh process reads state=${disabled}`);

            const heard = await presenceBecomes(origin, session.cookie, subject, (row) => row?.platformState === 'disabled');
            settle('L14', heard?.platformState === 'disabled' && !heard.present, `${subject}: the running API reports platformState=${String(heard?.platformState)} present=${String(heard?.present)}`);

            const enable = await operator('module:enable', subject);
            const enabled = await registryState();
            const back = await presenceBecomes(origin, session.cookie, subject, (row) => row?.present === true);
            settle(
              'L15',
              enable.code === 0 && enabled === 'installed' && back?.present === true,
              `${subject}: exit ${String(enable.code)}, a fresh process reads state=${enabled}, the running API reports present=${String(back?.present)}`,
            );

            const uninstall = await operator('module:uninstall', subject);
            const uninstalled = await registryState();
            const install2 = await operator('module:install', subject);
            const reinstalled = await registryState();
            settle(
              'L16',
              uninstall.code === 0 && uninstalled === 'uninstalled' && install2.code === 0 && reinstalled === 'installed',
              `${subject}: uninstall exit ${String(uninstall.code)} then state=${uninstalled}; install exit ${String(install2.code)} then state=${reinstalled}`,
            );

            // ── L18: the destructive half ─────────────────────────────────────
            // In an instance every module is an installed package, so this is
            // the command that could never succeed while the entry point
            // supplied no migration ownership. `migrate` is what puts back the
            // tables a hard uninstall reverted; `module:install` alone would
            // run the install hook over relations that are gone.
            const unforced = await operator('module:uninstall', subject, '--hard');
            const hard = await operator('module:uninstall', subject, '--hard', '--force');
            const reverted = /migrations reverted: (.*)/.exec(hard.output)?.[1]?.trim() ?? 'not reported';
            const gone = await registryState();
            const migrated = await operator('migrate');
            const install3 = await operator('module:install', subject);
            const restoredState = await registryState();
            settle(
              'L18',
              unforced.code === 64 &&
                hard.code === 0 &&
                hard.output.includes('registry row deleted') &&
                gone !== 'installed' &&
                migrated.code === 0 &&
                install3.code === 0 &&
                restoredState === 'installed',
              `${subject}: without --force exit ${String(unforced.code)}; --hard --force exit ${String(hard.code)}, reverted ${reverted}, then state=${gone}; ` +
                `migrate exit ${String(migrated.code)}, install exit ${String(install3.code)} then state=${restoredState}`,
            );
          }
        }
      }
    }
    verdicts.push(login);

    let overlayRoute: Verdict = {
      id: 'L10',
      title: "the overlay module's route answers, with no file of the instance edited by hand",
      status: 'unmeasured',
      detail: 'the instance did not start with an overlay module installed',
    };
    if (overlayGenerated?.code === 0 && login.status !== 'unmeasured' && (api as ChildProcess | null)?.exitCode === null) {
      const path = `/api/v1/${OVERLAY_MODULE_ID.replace(/_/g, '-')}`;
      const reply = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
        signal: AbortSignal.timeout(20_000),
      });
      const body = await reply.text();
      overlayRoute = {
        ...overlayRoute,
        status: reply.status === 200 && body.includes(OVERLAY_MODULE_ID) ? 'pass' : 'fail',
        detail: `GET ${path} → ${String(reply.status)} ${body.slice(0, 200)}`,
      };
    }
    verdicts.push(overlayRoute);
    verdicts.push(...lifecycle);
    verdicts.push({
      id: 'L17',
      title: 'the password is in nothing the one-shot printed',
      status: install.output.includes(admin.password) ? 'fail' : 'pass',
      detail: install.output.includes(admin.password) ? 'it was echoed' : 'not echoed',
    });

    // ── the storefront it wrote renders a demo product ───────────────────
    if (withStorefront) {
      const storefrontDir = `${target}-storefront`;
      const written = existsSync(join(storefrontDir, 'package.json'));
      const installed = existsSync(join(storefrontDir, 'node_modules', 'next', 'package.json'));
      verdicts.push({
        id: 'L18',
        title: 'outside any checkout, the one-shot wrote the storefront beside the instance and installed it',
        status: written && installed ? 'pass' : 'fail',
        detail: !written
          ? `${storefrontDir} holds no package.json`
          : installed
            ? `${storefrontDir}: written, and \`next\` is installed in it`
            : `${storefrontDir} was written and \`next\` is not installed in it`,
      });
      let rendered: Verdict = {
        id: 'L19',
        title: 'the storefront builds, starts, and renders a demo product against the instance API',
        status: 'unmeasured',
        detail: 'the API is not answering, or the storefront was not installed',
      };
      // The lifecycle verdicts above stop and start the API, so "it signed an
      // administrator in" is not "it is running now": ask it.
      const apiLive =
        (api as ChildProcess | null)?.exitCode === null &&
        (await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`, { signal: AbortSignal.timeout(20_000) })
          .then((reply) => reply.status === 200)
          .catch(() => false));
      if (written && installed && login.status === 'pass' && apiLive) {
        // The storefront's own toolchain sets NODE_ENV; a value inherited from
        // this process would displace it (`declaredVariablesOf`'s header).
        const { NODE_ENV: _dropped, ...shopEnvironment } = environment;
        const build = await exec('pnpm', ['run', 'build'], {
          cwd: storefrontDir,
          env: shopEnvironment,
          timeoutMs: STOREFRONT_BUILD_TIMEOUT_MS,
        });
        if (build.code !== 0) {
          rendered = {
            ...rendered,
            status: 'fail',
            detail: `\`pnpm run build\` exited ${String(build.code)}: ${build.output.trim().split('\n').slice(-10).join(' | ')}`,
          };
        } else {
          const shopPort = await freePort();
          console.log(`\n$ PORT=${String(shopPort)} pnpm run start`);
          shop = spawn('pnpm', ['run', 'start'], {
            cwd: storefrontDir,
            env: { ...shopEnvironment, PORT: String(shopPort) },
            stdio: ['ignore', 'inherit', 'inherit'],
            detached: true,
          });
          const origin = `http://127.0.0.1:${String(shopPort)}`;
          const up = await waitFor(`${origin}/catalog`, Date.now() + BOOT_TIMEOUT_MS, shop);
          if (up !== 200) {
            rendered = {
              ...rendered,
              status: 'fail',
              detail: shop.exitCode === null ? `/catalog answered ${String(up)}` : `start exited ${String(shop.exitCode)}`,
            };
          } else {
            const catalogue = await (await fetch(`${origin}/catalog`, { signal: AbortSignal.timeout(60_000) })).text();
            const link = /href="(\/p\/[^"]+)"/.exec(catalogue)?.[1];
            if (link === undefined) {
              rendered = { ...rendered, status: 'fail', detail: '/catalog answered 200 and links no product' };
            } else {
              const product = await fetch(`${origin}${link}`, { signal: AbortSignal.timeout(60_000) });
              const html = await product.text();
              const title = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
              rendered = {
                ...rendered,
                status: product.status === 200 && title.length > 0 ? 'pass' : 'fail',
                detail: `/catalog 200 links ${link}; it answered ${String(product.status)}${title.length > 0 ? ` and renders "${title}"` : ' and renders no heading'}`,
              };
            }
          }
        }
      }
      verdicts.push(rendered);
    }
  } finally {
    if (shop !== null) await stopGroup(shop);
    if (api !== null) await stopGroup(api);
    if (registry !== null) await registry.close();
    if (withServices && target.length > 0 && existsSync(join(target, 'compose.dev.yml'))) {
      // From the instance's own directory, so Compose reads the `.env` that
      // names the ports this run published — and removes this run's project only.
      spawnSync('docker', ['compose', '-f', 'compose.dev.yml', 'down', '-v'], { cwd: target, stdio: 'inherit' });
    }
    if (database !== null) {
      await resetDatabase(database.adminUrl, database.databaseName, false).catch(() => undefined);
    }
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
