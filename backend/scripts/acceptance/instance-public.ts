/**
 * The `public` acceptance mode — a stranger installs Endora Commerce from
 * public npmjs (`specs/136-open-source-publication/spec.md` §6.4, GAP-8,
 * FR-070; plan W5.4).
 *
 * ## What it does
 *
 * On a machine with Node and Docker and nothing else of ours — a GitHub-hosted
 * runner, clean by construction — it types the commands a stranger types, in a
 * directory with no workspace and no git above it:
 *
 *   1. `npx --yes create-endora-commerce@<version> shop --non-interactive …`
 *   2. `cd shop && pnpm run dev:all`
 *
 * and then judges §6.4's five properties (`instance-public-assertions.ts`).
 * The list is {@link strangerCommands}: P5 counts what ran, not a description.
 *
 * ## Dormant until there is something to install
 *
 * Until `0.100.0` is on npmjs there is nothing for step 1 to fetch, so the
 * workflow that runs this (`.github/workflows/acceptance-public.yml`) is
 * `workflow_dispatch` only. Nightly and per-release runs, and promoting
 * `latest` only after this passes on `next`, are FR-071 and plan W5.5 — after
 * the first publish, not before it.
 *
 * ## What it refuses to measure (exit 2)
 *
 * A machine that is not a stranger's: an `.npmrc` it would read, a registry
 * credential or override in the environment, a default registry other than
 * npmjs, or a target with a workspace or a git repository above it. Each is a
 * run that would measure this runner's configuration rather than the published
 * packages. No version is invented either: `--version` (or
 * `ENDORA_PUBLIC_VERSION`) is required.
 *
 * ## It cleans up after itself
 *
 * The development stack the one-shot started is taken down with its volumes
 * (`docker compose … down -v`) and the target is deleted, whatever the verdict.
 *
 * Usage: `npx --yes tsx@4 backend/scripts/acceptance/instance-public.ts
 * --version <v> [--package <name>]` — deliberately **not** through `pnpm`:
 * see the header of `instance-public-assertions.ts`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  PUBLIC_NPM_REGISTRY,
  cleanMachineRefusals,
  evaluateCommandCount,
  evaluateLicences,
  evaluateLockfile,
  evaluateLogin,
  evaluateStorefront,
  formatPublicReport,
  publicExitCode,
  strangerCommands,
  type InstalledManifest,
  type PublicAssertionResult,
} from './instance-public-assertions.js';

const HEALTH_PATH = '/api/v1/_health';
const LOGIN_PATH = '/api/v1/auth/admin/login';
const INSTALL_TIMEOUT_MS = 45 * 60_000;
const BOOT_TIMEOUT_MS = 5 * 60_000;

function refuse(message: string): never {
  console.error(`[instance-acceptance:public] cannot measure: ${message}`);
  console.error('[instance-acceptance:public] exit 2 — neither a pass nor a failure of the criterion.');
  process.exit(2);
}

/** Every `.npmrc` npm or pnpm would read for a command run in `dir`. */
function npmrcFilesFor(dir: string): readonly string[] {
  const found: string[] = [];
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (existsSync(join(current, '.npmrc'))) found.push(join(current, '.npmrc'));
    if (dirname(current) === current) break;
  }
  // The user file npm will read: `npm_config_userconfig` when `npx` exported
  // it (it always does, to the default path), `~/.npmrc` otherwise.
  for (const user of [process.env['npm_config_userconfig'], join(homedir(), '.npmrc')]) {
    if (user !== undefined && user.length > 0 && existsSync(user) && !found.includes(user)) {
      found.push(user);
    }
  }
  const prefix = spawnSync('npm', ['config', 'get', 'globalconfig'], { encoding: 'utf8' });
  const global = prefix.status === 0 ? prefix.stdout.trim() : '';
  if (global.length > 0 && existsSync(global)) found.push(global);
  return found;
}

/** A workspace or a git repository above the target is a machine with a context. */
function contextAbove(dir: string): string | null {
  for (let current = resolve(dir); ; current = dirname(current)) {
    for (const marker of ['pnpm-workspace.yaml', '.git', 'package.json', 'node_modules']) {
      if (existsSync(join(current, marker))) return join(current, marker);
    }
    if (dirname(current) === current) return null;
  }
}

/** Run one of the stranger's commands through a shell, output streamed and kept. */
function typeCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult) => {
    console.log(`\n$ ${command.split(' --admin-password ')[0]!} …`);
    const child = spawn('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output = `${output}${text}`.slice(-200_000);
      process.stdout.write(text);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
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

/** Wait until `url` answers, or the deadline passes. */
async function waitFor(url: string, deadline: number): Promise<number | null> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return response.status;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    }
  }
  return null;
}

/** The instance's `PORT`, off its own `.env`; the platform's default otherwise. */
function apiPort(instanceDir: string): number {
  const envPath = join(instanceDir, '.env');
  if (existsSync(envPath)) {
    const match = /^\s*PORT\s*=\s*(\d+)\s*$/m.exec(readFileSync(envPath, 'utf8'));
    if (match !== null) return Number(match[1]);
  }
  return 3001;
}

/**
 * Every package manifest an install left on disk: the instance's own store,
 * and the `npx` cache entry that holds the one-shot and the CLI it resolved.
 */
function installedManifests(instanceDir: string, packageName: string): InstalledManifest[] {
  const manifests: InstalledManifest[] = [];
  const readPackageDir = (dir: string): void => {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) return;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
        license?: unknown;
      };
      if (typeof manifest.name !== 'string') return;
      manifests.push({
        name: manifest.name,
        version: typeof manifest.version === 'string' ? manifest.version : '?',
        license: typeof manifest.license === 'string' ? manifest.license : null,
      });
    } catch {
      // An unreadable manifest is not a licence; it is left out of the count.
    }
  };
  // Real directories only: every symlink in a pnpm tree points at one of these.
  const walkNodeModules = (nodeModules: string): void => {
    if (!existsSync(nodeModules)) return;
    for (const entry of readdirSync(nodeModules)) {
      if (entry.startsWith('.')) continue;
      const path = join(nodeModules, entry);
      if (lstatSync(path).isSymbolicLink()) continue;
      if (entry.startsWith('@')) {
        for (const scoped of readdirSync(path)) {
          const scopedPath = join(path, scoped);
          if (!lstatSync(scopedPath).isSymbolicLink()) readPackageDir(scopedPath);
        }
      } else {
        readPackageDir(path);
      }
    }
  };
  const store = join(instanceDir, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      walkNodeModules(join(store, entry, 'node_modules'));
    }
  }
  const cache = spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8' });
  const npx = cache.status === 0 ? join(cache.stdout.trim(), '_npx') : null;
  if (npx !== null && existsSync(npx)) {
    for (const entry of readdirSync(npx)) {
      const nodeModules = join(npx, entry, 'node_modules');
      if (existsSync(join(nodeModules, packageName))) walkNodeModules(nodeModules);
    }
  }
  return manifests;
}

/** Stop a process group started with `detached: true`, politely and then not. */
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

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      package: { type: 'string' },
    },
  });
  const version = (values.version ?? process.env['ENDORA_PUBLIC_VERSION'] ?? '').trim();
  if (version.length === 0) {
    refuse(
      '--version is required (or ENDORA_PUBLIC_VERSION). A published version or dist-tag is the ' +
        'subject of this mode, and a default would be a version nobody chose.',
    );
  }
  // 125 §7.4's name; T6-D's scoped fallback is the one other value this takes.
  const packageName = (values.package ?? 'create-endora-commerce').trim();

  const host = realpathSync(mkdtempSync(join(process.env['RUNNER_TEMP'] ?? tmpdir(), 'endora-public-')));
  const dirName = 'shop';
  const instanceDir = join(host, dirName);
  const notes: string[] = [`${packageName}@${version}`, `host ${host}`];

  const above = contextAbove(host);
  if (above !== null) {
    rmSync(host, { recursive: true, force: true });
    refuse(`${above} is above the target. A stranger's directory has no workspace and no git above it.`);
  }
  const registry = spawnSync('npm', ['config', 'get', 'registry'], { cwd: host, encoding: 'utf8' });
  const refusals = cleanMachineRefusals({
    npmrcFiles: npmrcFilesFor(host),
    env: process.env,
    npmRegistry: registry.status === 0 ? registry.stdout.trim() : null,
  });
  if (refusals.length > 0) {
    rmSync(host, { recursive: true, force: true });
    refuse(`this is not a stranger's machine:\n  - ${refusals.join('\n  - ')}`);
  }
  // A version that is not on npmjs is nothing to measure rather than a product
  // failing: refused here, so a red P1 below can only mean the one-shot failed.
  const published = spawnSync('npm', ['view', `${packageName}@${version}`, 'version'], {
    cwd: host,
    encoding: 'utf8',
  });
  if (published.status !== 0 || published.stdout.trim().length === 0) {
    rmSync(host, { recursive: true, force: true });
    refuse(
      `${packageName}@${version} is not on ${PUBLIC_NPM_REGISTRY} ` +
        `(npm view exited ${String(published.status)}). Until the first publish there is nothing ` +
        'for a stranger to install, which is why the workflow is dispatch-only.',
    );
  }
  if (spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status !== 0) {
    rmSync(host, { recursive: true, force: true });
    refuse('no Docker daemon answered, and the one-shot starts the development services with it.');
  }

  const admin = {
    email: 'owner@example.com',
    // This run's own value, never the product's: the one-shot refuses to
    // generate a password, so the stranger — here, the harness — supplies one.
    password: randomBytes(18).toString('base64url'),
    firstName: 'Public',
    lastName: 'Acceptance',
  };
  const typed = strangerCommands({ packageName, version, dir: dirName, admin });
  const results: PublicAssertionResult[] = [];
  let devAll: ChildProcess | null = null;

  try {
    // ── 1. the one-shot ───────────────────────────────────────────────────────
    const install = await typeCommand(typed[0]!, host, INSTALL_TIMEOUT_MS);
    const installed = install.code === 0;
    if (!installed) notes.push(`the one-shot exited ${String(install.code)}`);

    // ── 2. one command for every layer ────────────────────────────────────────
    let healthStatus: number | null = null;
    let loginStatus: number | null = null;
    let loginBody = '';
    if (installed) {
      console.log(`\n$ ${typed[1]!}`);
      devAll = spawn('sh', ['-c', typed[1]!], {
        cwd: host,
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
      });
      const port = apiPort(instanceDir);
      healthStatus = await waitFor(
        `http://127.0.0.1:${String(port)}${HEALTH_PATH}`,
        Date.now() + BOOT_TIMEOUT_MS,
      );
      if (healthStatus === 200) {
        try {
          const login = await fetch(`http://127.0.0.1:${String(port)}${LOGIN_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: admin.email, password: admin.password }),
            signal: AbortSignal.timeout(20_000),
          });
          loginStatus = login.status;
          loginBody = await login.text();
        } catch (thrown) {
          loginBody = thrown instanceof Error ? thrown.message : String(thrown);
        }
      } else {
        loginBody = devAll.exitCode === null ? 'the API did not answer in time' : `dev:all exited ${String(devAll.exitCode)}`;
      }
    }

    results.push(
      evaluateLogin({
        healthStatus,
        loginStatus,
        body: loginBody,
        ...(installed
          ? {}
          : {
              installFailed:
                `the one-shot exited ${String(install.code)}; its last lines: ` +
                install.output.trim().split('\n').slice(-8).join(' | '),
            }),
      }),
      evaluateStorefront({ written: existsSync(join(host, `${dirName}-storefront`, 'package.json')) }),
      evaluateLockfile({
        lockfile: existsSync(join(instanceDir, 'pnpm-lock.yaml'))
          ? readFileSync(join(instanceDir, 'pnpm-lock.yaml'), 'utf8')
          : null,
        instanceNpmrc: existsSync(join(instanceDir, '.npmrc'))
          ? readFileSync(join(instanceDir, '.npmrc'), 'utf8')
          : null,
      }),
      evaluateLicences(installedManifests(instanceDir, packageName)),
      evaluateCommandCount(installed ? typed : typed.slice(0, 1), installed),
    );
  } finally {
    if (devAll !== null) await stopGroup(devAll);
    const compose = join(instanceDir, 'compose.dev.yml');
    if (existsSync(compose)) {
      spawnSync('docker', ['compose', '-f', compose, 'down', '-v'], { cwd: instanceDir, stdio: 'inherit' });
    }
    rmSync(host, { recursive: true, force: true });
  }

  console.log(`\n${formatPublicReport(results, notes)}`);
  return publicExitCode(results);
}

process.exitCode = await main();
