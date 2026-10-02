/**
 * `acceptance:separate-components` — the API, the Admin UI and the storefront,
 * each stood up on its own, each on a port of its own
 * (`specs/138-separate-components/spec.md` FR-022, SC-001…SC-003;
 * `specs/110-instance-repository/contracts/instance-tree.md` §7.4).
 *
 * ## What it does
 *
 * The supply is `instance-local-registry.ts`'s: every publishable package of
 * this checkout is packed and served by a registry on `node:http`, and what a
 * stranger types is typed from an empty directory with nothing of ours above
 * it —
 *
 *   `npx --yes create-endora-commerce@<v> <dir> --non-interactive --only …`
 *
 * three times, into three directories standing in for three machines. Then the
 * three are started and made to talk to each other **by URL**: the admin's
 * origin signs an administrator in to the API with a real `Origin` header and
 * the cookie the answer set, and the storefront renders a product the API
 * seeded. S1–S7 are judged in `separate-components-assertions.ts`.
 *
 * ## Every port is the operating system's
 *
 * 3000, 3001, 3002, 5432, 6379 and 7700 are the development defaults, and on a
 * developer's machine every one of them is somebody's. The API, the admin and
 * the storefront each get a port `listen(0)` handed out, and the assertions
 * refuse a default.
 *
 * ## What it asks of the machine
 *
 *   * **`--services`** — a Docker daemon and nothing else. The API's run starts
 *     its own development stack, on whichever host ports are free, in a
 *     Compose project named after a directory unique to this run; it is taken
 *     down with its volumes afterwards.
 *   * **default** — `ACCEPTANCE_DATABASE_URL` naming a **disposable** database
 *     (its name must contain `test`; it is dropped and re-created),
 *     `REDIS_URL` and `MEILISEARCH_URL`, all three explicit. There is no
 *     default for any of them: each default would be somebody's development
 *     service.
 *
 * `pnpm run build:packages` must have run, in a git checkout: the CLI's build
 * is what packages the reference storefront.
 *
 * Usage: `pnpm --filter backend run acceptance:separate-components [--services] [--keep]`,
 * or the `:ci` form, which compares the run to
 * `backend/acceptance/separate-components-expected-state.json`.
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
import { startLocalRegistry, tarballFrom, type LocalRegistry } from './local-registry.js';
import {
  assertS1,
  assertS2,
  assertS3,
  assertS4,
  assertS5,
  assertS6,
  assertS7,
  compareToExpected,
  stepIdsOf,
  type S7Case,
  type Verdict,
  type VerdictStatus,
} from './separate-components-assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
const EXPECTATION_FILE = resolve(SCRIPT_DIR, '..', '..', 'acceptance', 'separate-components-expected-state.json');
const UPSTREAM = 'https://registry.npmjs.org';
const FRONT_DOOR = 'create-endora-commerce';
const HEALTH_PATH = '/api/v1/_health';
const LOGIN_PATH = '/api/v1/auth/admin/login';
/** A route that answers 200 to a signed-in administrator and 401 to nobody. */
const SESSION_PATH = '/api/v1/admin/me';
const INSTALL_TIMEOUT_MS = 60 * 60_000;
const BOOT_TIMEOUT_MS = 5 * 60_000;
const STOREFRONT_BUILD_TIMEOUT_MS = 20 * 60_000;
/** The addresses of the services an API needs — and an admin-only run must never be given. */
const SERVICE_ADDRESSES = ['DATABASE_URL', 'REDIS_URL', 'MEILISEARCH_URL', 'ACCEPTANCE_DATABASE_URL'];

function refuse(message: string): never {
  console.error(`[acceptance:separate-components] cannot measure: ${message}`);
  console.error('[acceptance:separate-components] exit 2 — neither a pass nor a failure.');
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

/** A free port, from the operating system. */
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
 * This process's environment as a stranger's shell has it: no package-manager
 * setting inherited, no service address, and this run's registry.
 */
function strangerEnvironment(registry: string, scratch: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(npm_|pnpm_)/i.test(name) && !SERVICE_ADDRESSES.includes(name) && name !== 'NODE_ENV' && name !== 'PORT',
    ),
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
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; shown?: string; quiet?: boolean },
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult) => {
    console.log(`\n$ ${options.shown ?? [command, ...args].join(' ')}`);
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      output = `${output}${text}`.slice(-800_000);
      if (options.quiet !== true) process.stdout.write(text);
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
  const result = spawnSync('pnpm', ['pack', '--pack-destination', destination], { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) refuse(`\`pnpm pack\` failed in ${dir}:\n${result.stdout}${result.stderr}`);
  const written = readdirSync(destination).filter((entry) => entry.endsWith('.tgz') && !before.has(entry));
  if (written.length !== 1) refuse(`\`pnpm pack\` in ${dir} wrote ${String(written.length)} tarballs, expected one`);
  return join(destination, written[0]!);
}

async function resetDatabase(adminUrl: string, name: string, create: boolean): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error: unknown) {
    if (!create) return;
    refuse(`PostgreSQL is not reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    if (create) await client.query(`create database "${name}"`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function waitFor(url: string, deadline: number, child: ChildProcess): Promise<number | null> {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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

/** A layer started in its own process group, so stopping it stops what it started. */
function start(label: string, cwd: string, script: string, env: NodeJS.ProcessEnv): ChildProcess {
  console.log(`\n$ (${label}) pnpm run ${script}   # in ${cwd}`);
  return spawn('pnpm', ['run', script], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
}

/** The answered assignments of a `.env`, without a parser this script would have to trust. */
function envOf(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null || match[2]!.length === 0) continue;
    values[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return values;
}

/** Every `.js` under `dir`, concatenated — a bundle is searched, not parsed. */
function scriptsUnder(dir: string): string {
  if (!existsSync(dir)) return '';
  let text = '';
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) text += scriptsUnder(path);
    else if (entry.name.endsWith('.js')) text += readFileSync(path, 'utf8');
  }
  return text;
}

const unmeasured = (id: string, title: string, detail: string): Verdict => ({ id, title, status: 'unmeasured', detail });

async function main(): Promise<number> {
  const { values } = parseArgs({
    // pnpm hands a `--` typed before the flags on to the script, where it would
    // end the options: `pnpm run <script> -- --services` and `pnpm run <script>
    // --services` are both what people type, and both mean the flag.
    args: process.argv.slice(2).filter((argument) => argument !== '--'),
    options: {
      keep: { type: 'boolean' },
      services: { type: 'boolean' },
      'against-expectation': { type: 'boolean' },
    },
  });
  const withServices = values.services === true;
  const ratchet = values['against-expectation'] === true;
  if (ratchet && !existsSync(EXPECTATION_FILE)) {
    refuse(`--against-expectation was asked for and ${EXPECTATION_FILE} does not exist`);
  }
  const dockerAnswers =
    (spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' }).stdout ?? '').trim().length > 0;
  let database: { adminUrl: string; databaseName: string; databaseUrl: string } | null = null;
  const given: Record<string, string> = {};
  if (withServices) {
    if (!dockerAnswers) refuse('--services was given and no Docker daemon answered.');
  } else {
    const dsn = (process.env['ACCEPTANCE_DATABASE_URL'] ?? '').trim();
    if (dsn.length === 0) {
      refuse(
        'ACCEPTANCE_DATABASE_URL is required and has no default: the database it names is dropped. ' +
          'Pass --services to let the API\'s run start its own development stack instead.',
      );
    }
    const target = resolveDatabaseTarget(dsn);
    if ('error' in target) refuse(target.error);
    database = target;
    for (const name of ['REDIS_URL', 'MEILISEARCH_URL']) {
      const value = (process.env[name] ?? '').trim();
      if (value.length === 0) {
        refuse(`${name} is required and has no default: the default would be somebody's development service.`);
      }
      given[name] = value;
    }
    given['DATABASE_URL'] = database.databaseUrl;
  }

  // ── pack ────────────────────────────────────────────────────────────────
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'endora-separate-components-')));
  const above = contextAbove(scratch);
  if (above !== null) {
    rmSync(scratch, { recursive: true, force: true });
    refuse(`${above} is above ${scratch}. A stranger's directory has nothing of ours above it.`);
  }
  const tarballDir = join(scratch, 'tarballs');
  mkdirSync(tarballDir);
  const packages = publishablePackages(join(REPO_ROOT, 'packages'));
  const frontDoor = workspaceMembers(REPO_ROOT, nodeWorkspaceFs()).find((member) => member.name === FRONT_DOOR);
  if (frontDoor === undefined) refuse(`no workspace package is named ${FRONT_DOOR}`);
  const toPack = [...packages.map((pkg) => pkg.dir), ...(packages.some((pkg) => pkg.name === FRONT_DOOR) ? [] : [frontDoor.dir])];
  for (const dir of toPack) {
    if (!existsSync(join(dir, 'dist'))) refuse(`${dir} has no dist — run \`pnpm run build:packages\` first`);
  }
  if (!existsSync(join(REPO_ROOT, 'packages', 'cli', 'dist', 'storefront-reference', 'reference.json'))) {
    refuse(
      'packages/cli/dist/storefront-reference/reference.json is absent — the CLI build writes it ' +
        'from a git checkout that holds the storefront; run `pnpm run build:packages` in one',
    );
  }
  console.log(`[acceptance:separate-components] packing ${String(toPack.length)} packages into ${tarballDir}`);
  const tarballs = toPack.map((dir) => {
    const file = pack(dir, tarballDir);
    return tarballFrom(file, readFileSync(file));
  });
  const version = tarballs.find((tarball) => tarball.name === FRONT_DOOR)!.version;

  let registry: LocalRegistry | null = null;
  const running: ChildProcess[] = [];
  const verdicts: Verdict[] = [];
  const notes: string[] = [];
  // Unique to this run: with `--services` a directory's name is its Compose
  // project's, and two runs on one machine must not share containers.
  const tag = randomBytes(3).toString('hex');
  const work = join(scratch, 'work');
  const apiDir = join(work, `api-${tag}`);
  const adminDir = join(work, `admin-${tag}`);
  const shopDir = join(work, `shop-${tag}`);
  mkdirSync(work, { recursive: true });
  try {
    registry = await startLocalRegistry({ tarballs, upstream: UPSTREAM });
    notes.push(`registry ${registry.url}: ${String(tarballs.length)} local tarballs, everything else from ${UPSTREAM}`);
    if (database !== null) await resetDatabase(database.adminUrl, database.databaseName, true);
    const environment = strangerEnvironment(registry.url, scratch);
    const [apiPort, adminPort, shopPort, foreignPort] = [await freePort(), await freePort(), await freePort(), await freePort()];
    // `localhost`, not 127.0.0.1: both session cookies are host-only, and the
    // three origins have to be one site for a browser to send them (R7.8).
    const apiOrigin = `http://localhost:${String(apiPort)}`;
    const adminOrigin = `http://localhost:${String(adminPort)}`;
    const shopOrigin = `http://localhost:${String(shopPort)}`;
    const administrator = {
      email: 'owner@example.com',
      password: randomBytes(18).toString('base64url'),
      firstName: 'Separate',
      lastName: 'Components',
    };
    const administratorFlags = [
      '--admin-email',
      administrator.email,
      '--admin-password',
      administrator.password,
      '--admin-first-name',
      administrator.firstName,
      '--admin-last-name',
      administrator.lastName,
    ];
    const oneShot = (dir: string, flags: readonly string[], quiet = false): Promise<{ code: number; output: string }> =>
      exec('npx', ['--yes', `${FRONT_DOOR}@${version}`, dir, '--non-interactive', ...flags], {
        cwd: work,
        env: environment,
        timeoutMs: INSTALL_TIMEOUT_MS,
        quiet,
        shown: `npx --yes ${FRONT_DOOR}@${version} ${dir} --non-interactive ${flags
          .map((flag, index) => (flags[index - 1] === '--admin-password' || flags[index - 1] === '--revalidate-secret' ? '…' : flag))
          .join(' ')}`,
      });

    // ── S7 — what a selection refuses, before anything is stood up ─────────
    const refusals: readonly (readonly [string, readonly string[], readonly string[]])[] = [
      ['refused-1', ['--only', 'admin'], ['--api-url']],
      ['refused-2', ['--only', 'storefront'], ['--api-url', '--storefront-url', '--revalidate-secret']],
      [
        'refused-3',
        ['--only', 'storefront', '--api-url', apiOrigin, '--storefront-url', shopOrigin, '--revalidate-secret', 'x', '--demo'],
        ['--demo'],
      ],
      ['refused-4', ['--only', 'admin', '--without', 'admin', '--api-url', apiOrigin], ['--only admin', '--without admin']],
    ];
    const cases: S7Case[] = [];
    for (const [dir, flags, mustName] of refusals) {
      const run = await oneShot(dir, flags);
      cases.push({
        name: flags.join(' '),
        exitCode: run.code,
        output: run.output,
        mustName,
        wrote: existsSync(join(work, dir)),
      });
    }
    verdicts.push(assertS7(cases));

    // ── S6 — the run that selects nothing, planned ─────────────────────────
    const everything = await oneShot('all', [
      '--dry-run',
      '--demo',
      ...(dockerAnswers ? [] : ['--no-services']),
      ...administratorFlags,
    ]);
    verdicts.push(
      everything.code === 0
        ? assertS6({ stepIds: stepIdsOf(everything.output), services: dockerAnswers, demo: true, storefront: true })
        : unmeasured('S6', 'with no `--only`, the planned steps are the ones recorded before the flag existed', `the dry run exited ${String(everything.code)}`),
    );

    // ── S1 — the API alone ─────────────────────────────────────────────────
    mkdirSync(apiDir, { recursive: true });
    // The one file a stranger may place in the target before the run: the port
    // their API listens on, and — where they run the services — where those are.
    writeFileSync(
      join(apiDir, '.env'),
      `${Object.entries({ ...given, PORT: String(apiPort) }).map(([name, value]) => `${name}=${value}`).join('\n')}\n`,
      'utf8',
    );
    const api = await oneShot(`api-${tag}`, [
      '--only',
      'api',
      '--demo',
      ...(withServices ? [] : ['--no-services']),
      '--api-url',
      apiOrigin,
      '--admin-url',
      adminOrigin,
      '--storefront-url',
      shopOrigin,
      ...administratorFlags,
    ]);
    let health: number | null = null;
    if (api.code === 0) {
      const server = start('api', apiDir, 'start', environment);
      running.push(server);
      health = await waitFor(`${apiOrigin}${HEALTH_PATH}`, Date.now() + BOOT_TIMEOUT_MS, server);
    }
    verdicts.push(
      assertS1({
        exitCode: api.code,
        stepIds: stepIdsOf(api.output),
        services: withServices,
        demo: true,
        adminDirExists: existsSync(join(apiDir, 'admin')),
        storefrontWritten: existsSync(`${apiDir}-storefront`),
        health,
        port: apiPort,
      }),
    );
    if (api.output.includes(administrator.password)) notes.push('the administrator password was echoed by the API run');
    const apiUp = health === 200;
    const apiSecret = envOf(join(apiDir, '.env'))['REVALIDATE_SECRET'];

    // ── S2 — the admin alone, with no database and no service ──────────────
    const adminRun = await oneShot(`admin-${tag}`, ['--only', 'admin', '--api-url', apiOrigin]);
    const bundle = scriptsUnder(join(adminDir, 'admin', 'dist'));
    verdicts.push(
      assertS2({
        exitCode: adminRun.code,
        stepIds: stepIdsOf(adminRun.output),
        distExists: existsSync(join(adminDir, 'admin', 'dist', 'index.html')),
        apiOrigin,
        bundleNamesApiOrigin: bundle.includes(apiOrigin),
        bundleNamesDefaultOrigin: bundle.includes('localhost:3001'),
        serviceAddressesInEnvironment: SERVICE_ADDRESSES.filter((name) => environment[name] !== undefined),
        containersStartedForIt: dockerAnswers
          ? (spawnSync('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=admin-${tag}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout ?? '')
              .split('\n')
              .filter((name) => name.trim().length > 0)
          : [],
      }),
    );

    // ── S3 — from the admin's origin, an administrator signs in ────────────
    const s3Title = 'from the admin\'s own origin, an administrator signs in to the API and the cookie is honoured';
    if (adminRun.code !== 0 || !apiUp) {
      verdicts.push(unmeasured('S3', s3Title, 'the API is not up or the admin was not built'));
    } else {
      // On a port of its own, which is not the one `admin/.env` may name: the
      // environment wins over the file, as it does for any Vite configuration.
      const preview = start('admin', adminDir, 'preview:admin', { ...environment, PORT: String(adminPort) });
      running.push(preview);
      const adminIndex = await waitFor(`${adminOrigin}/`, Date.now() + BOOT_TIMEOUT_MS, preview);
      const preflight = (origin: string): Promise<Response> =>
        fetch(`${apiOrigin}${LOGIN_PATH}`, {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
          signal: AbortSignal.timeout(20_000),
        });
      const allowed = await preflight(adminOrigin);
      const foreignOrigin = `http://localhost:${String(foreignPort)}`;
      const foreign = await preflight(foreignOrigin);
      const login = await fetch(`${apiOrigin}${LOGIN_PATH}`, {
        method: 'POST',
        headers: { origin: adminOrigin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: administrator.email, password: administrator.password }),
        signal: AbortSignal.timeout(20_000),
      });
      const cookie = login.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0]!)
        .join('; ');
      const session = (headers: Record<string, string>): Promise<Response> =>
        fetch(`${apiOrigin}${SESSION_PATH}`, { headers: { origin: adminOrigin, ...headers }, signal: AbortSignal.timeout(20_000) });
      verdicts.push(
        assertS3({
          origin: adminOrigin,
          adminIndex: { status: adminIndex },
          preflight: {
            allowOrigin: allowed.headers.get('access-control-allow-origin'),
            allowCredentials: allowed.headers.get('access-control-allow-credentials'),
          },
          login: {
            status: login.status,
            allowOrigin: login.headers.get('access-control-allow-origin'),
            allowCredentials: login.headers.get('access-control-allow-credentials'),
            sessionCookie: cookie.length > 0,
          },
          authenticated: { status: (await session({ cookie })).status },
          anonymous: { status: (await session({})).status },
          foreignPreflight: { origin: foreignOrigin, allowOrigin: foreign.headers.get('access-control-allow-origin') },
        }),
      );
    }

    // ── S4 / S5 — the storefront alone, given the API's secret ─────────────
    const s4Title = '`--only storefront`: no instance, its five values, and a page rendered from S1\'s data';
    const s5Title = 'the storefront honours the API\'s secret and no other, and the two files hold one value';
    if (!apiUp || apiSecret === undefined) {
      const why = apiUp ? "the API's .env holds no REVALIDATE_SECRET to give the storefront" : 'the API is not up';
      verdicts.push(unmeasured('S4', s4Title, why), unmeasured('S5', s5Title, why));
    } else {
      const shopRun = await oneShot(`shop-${tag}`, [
        '--only',
        'storefront',
        '--api-url',
        apiOrigin,
        '--storefront-url',
        shopOrigin,
        '--revalidate-secret',
        apiSecret,
      ]);
      if (shopRun.output.includes(apiSecret)) notes.push('the shared secret was echoed by the storefront run');
      let home: number | null = null;
      let product: { link: string; status: number; heading: string } | null = null;
      let withTheSecret = 0;
      let withAnother = 0;
      if (shopRun.code === 0) {
        const build = await exec('pnpm', ['run', 'build'], { cwd: shopDir, env: environment, timeoutMs: STOREFRONT_BUILD_TIMEOUT_MS });
        if (build.code !== 0) {
          notes.push(`the storefront's \`pnpm run build\` exited ${String(build.code)}`);
        } else {
          // No `PORT` handed in: the run wrote it into the storefront's own
          // `.env`, from the loopback origin it was given, and `start` reads it.
          const shop = start('storefront', shopDir, 'start', environment);
          running.push(shop);
          home = await waitFor(`${shopOrigin}/`, Date.now() + BOOT_TIMEOUT_MS, shop);
          if (home === 200) {
            const catalogue = await (await fetch(`${shopOrigin}/catalog`, { signal: AbortSignal.timeout(60_000) })).text();
            const link = /href="(\/p\/[^"]+)"/.exec(catalogue)?.[1];
            if (link !== undefined) {
              const page = await fetch(`${shopOrigin}${link}`, { signal: AbortSignal.timeout(60_000) });
              const html = await page.text();
              product = {
                link,
                status: page.status,
                heading: /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '',
              };
            }
            const revalidate = async (secret: string): Promise<number> =>
              (
                await fetch(`${shopOrigin}/api/revalidate`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
                  body: JSON.stringify({ tags: ['modules:presence'] }),
                  signal: AbortSignal.timeout(20_000),
                })
              ).status;
            withTheSecret = await revalidate(apiSecret);
            withAnother = await revalidate(`${apiSecret}-not`);
          }
        }
      }
      const shopEnv = envOf(join(shopDir, '.env'));
      verdicts.push(
        assertS4({
          exitCode: shopRun.code,
          stepIds: stepIdsOf(shopRun.output),
          instanceTreeExists: ['backend', 'pnpm-workspace.yaml', 'apps'].some((entry) => existsSync(join(shopDir, entry))),
          env: shopEnv,
          expected: { apiOrigin, siteOrigin: shopOrigin, salesChannel: 'default', secret: apiSecret },
          port: shopPort,
          home: { status: home },
          product,
        }),
      );
      verdicts.push(
        home === 200
          ? assertS5({
              withTheSecret: { status: withTheSecret },
              withAnother: { status: withAnother },
              apiSecret,
              storefrontSecret: shopEnv['REVALIDATE_SECRET'],
            })
          : unmeasured('S5', s5Title, 'the storefront is not up'),
      );
    }
  } finally {
    for (const child of running.reverse()) await stopGroup(child);
    if (registry !== null) await registry.close();
    if (withServices && existsSync(join(apiDir, 'compose.dev.yml'))) {
      // From the instance's own directory, so Compose reads the `.env` that
      // names the ports this run published — and removes this run's project only.
      spawnSync('docker', ['compose', '-f', 'compose.dev.yml', 'down', '-v'], { cwd: apiDir, stdio: 'inherit' });
    }
    if (database !== null) await resetDatabase(database.adminUrl, database.databaseName, false).catch(() => undefined);
    if (values.keep === true) notes.push(`kept ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }

  verdicts.sort((left, right) => left.id.localeCompare(right.id));
  console.log('\n[acceptance:separate-components] report');
  for (const note of notes) console.log(`  note: ${note}`);
  for (const entry of verdicts) {
    console.log(`  ${entry.id} ${entry.status.toUpperCase().padEnd(10)} ${entry.title} — ${entry.detail}`);
  }
  if (ratchet) {
    const expected = (JSON.parse(readFileSync(EXPECTATION_FILE, 'utf8')) as { expected: Record<string, VerdictStatus> }).expected;
    const comparison = compareToExpected(verdicts, expected);
    for (const line of comparison.drift) console.log(`  drift: ${line}`);
    console.log(`[acceptance:separate-components] against the recorded state: exit ${String(comparison.exitCode)}`);
    return comparison.exitCode;
  }
  return verdicts.some((entry) => entry.status === 'fail') ? 1 : verdicts.some((entry) => entry.status === 'unmeasured') ? 2 : 0;
}

process.exitCode = await main();
