/**
 * The acceptance criterion for module-owned Page Builder renderers
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §9).
 *
 * ## What it does, and why it is not a test in `backend/test/`
 *
 * The claim is about a package that is **not** a workspace member: a third
 * party's module, installed from a tarball, draws its own block. A test inside
 * the repository passes on a package that is not one — the fixture would be in
 * relative-specifier range and pnpm would link it. So this run leaves:
 *
 *   1. copies `backend/acceptance/block-renderers-fixture/` into a directory
 *      outside the repository, installs the packed packages it peer-depends on,
 *      builds it and packs it;
 *   2. runs `endora check` over it;
 *   3. scaffolds a storefront with `endora new storefront`, adds the fixture's
 *      tarball, runs `blocks:generate` and `next build`;
 *   4. runs a probe **with the storefront's own vitest** that server-renders a
 *      document holding the block — present, absent, back again, and forced to
 *      throw — and a second probe that renders the packed e-mail layer through
 *      the installed e-mail renderer.
 *
 * ## What it measures
 *
 * Every assertion of §9, on all three surfaces. The **storefront** half is a
 * scaffolded storefront built with `next build` and probed with its own
 * vitest. The **platform** half is `acceptance:package-schema`'s arrangement:
 * the tarball installed into a directory outside the repository, the real
 * composition root booted against it with a disposable database, and the
 * module switched on, off and on again — one platform process per state
 * (`block-renderers-probe.ts`), asked through the admin's own routes for a
 * transactional preview, a newsletter preview and the Page Builder descriptor.
 * The **admin** half is an instance scaffolded by `endora new instance` with
 * the fixture among its modules, installed from tarballs, generated and built
 * with Vite, and a probe bundled by that instance's own Vite which composes the
 * editors from the instance's generated registry over the descriptors the
 * platform served.
 *
 * It needs `ACCEPTANCE_DATABASE_URL` (a database whose name contains `test`;
 * it is dropped and re-created) and `REDIS_URL`, and exits 2 without them.
 *
 * ## Exit codes
 *
 *   0 — the criterion is met (or, with `--against-expectation`, nothing drifted).
 *   1 — something was measured and failed (or drifted).
 *   2 — it could not be measured.
 *
 * Usage: `pnpm --filter backend run acceptance:block-renderers`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRequiredGiven, type EnvironmentInput } from '@endora-commerce/contracts';

import { resolveDatabaseTarget } from './assertions.js';
import {
  checkVerdictOf,
  evaluateA1,
  evaluateA2,
  evaluateA3,
  evaluateA4,
  evaluateA5Package,
  evaluateA5Platform,
  evaluateA6Admin,
  evaluateA6Email,
  evaluateA6Storefront,
  evaluateA7Admin,
  evaluateA7Email,
  evaluateA7Storefront,
  evaluateA8Admin,
  evaluateA8Package,
  evaluateA8Platform,
  evaluateA8Storefront,
  FIXTURE_MODULE_ID,
  FIXTURE_PACKAGE,
  MARKER,
  type AdminProbe,
  type EmailProbe,
  type PlatformObservation,
  type StorefrontProbe,
} from './block-renderers-assertions.js';
import { explicitServiceAddresses, MissingServiceAddressError } from './instance-assertions.js';
import { startLocalRegistry, tarballFrom, type LocalRegistry } from './local-registry.js';
import { installInto, resetDatabase } from './package-schema.js';
import { armExitWatchdog, stopProcessGroup, trackProcessGroup } from './process-teardown.js';
import {
  compareToExpectation,
  exitCodeFor,
  exitCodeForExpectation,
  type AcceptanceExpectation,
  type AssertionResult,
} from './storefront-scaffold-assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const FIXTURE_SOURCE = join(BACKEND_ROOT, 'acceptance', 'block-renderers-fixture');
const EXPECTATION_FILE = join(BACKEND_ROOT, 'acceptance', 'block-renderers-expected-state.json');
const PREFIX = '[block-renderers-acceptance]';
const SCOPE = '@endora-commerce/';

const notes: string[] = [];

/** The run's directory outside the repository; removed on a refusal unless `--keep`. */
let workDirectory: string | null = null;

function refuse(message: string): never {
  if (workDirectory !== null && !process.argv.includes('--keep')) {
    rmSync(workDirectory, { recursive: true, force: true });
  }
  console.error(`${PREFIX} cannot measure: ${message}`);
  console.error(`${PREFIX} exit 2 — neither a pass nor a failure of the criterion.`);
  process.exit(2);
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
): { code: number; output: string } {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  if (result.error) refuse(`${command} could not be run: ${result.error.message}`);
  return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * The same, without blocking this process — which is what serves the local
 * registry the command installs from. The child leads its own process group,
 * tracked so an exit of this runner takes it along, and a timeout stops the
 * whole group rather than its leader.
 */
function runAsync(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<{ code: number; output: string }> {
  return new Promise((resolveResult) => {
    const child = trackProcessGroup(
      spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }),
    );
    let output = '';
    const keep = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-400_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      void stopProcessGroup(child, { signal: 'SIGKILL', graceMs: 0 });
    }, options.timeout);
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

/**
 * The environment of an install that resolves from the local registry and from
 * nothing this machine has configured — `instance-local-registry.ts`'s
 * arrangement: every inherited `npm_*`/`pnpm_*` name withheld, an empty user
 * configuration, a scratch cache.
 */
function registryEnvironment(registry: string, scratch: string): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(npm_|pnpm_)/i.test(name) && name !== 'NODE_ENV'),
  );
  mkdirSync(scratch, { recursive: true });
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `pnpm pack` one directory into `tarballDir`, and answer the tarball's path. */
function pack(dir: string, tarballDir: string): string {
  const before = new Set(readdirSync(tarballDir));
  const packed = run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: dir });
  if (packed.code !== 0) refuse(`\`pnpm pack\` failed in ${dir}:\n${packed.output}`);
  const written = readdirSync(tarballDir).filter((entry) => entry.endsWith('.tgz') && !before.has(entry));
  if (written.length !== 1) refuse(`\`pnpm pack\` in ${dir} wrote ${String(written.length)} tarballs`);
  return join(tarballDir, written[0]!);
}

/** Every package of this checkout by npm name — the packages and the module packages alike. */
let releaseDirectories: Map<string, string> | null = null;
function releaseDirectoryOf(name: string): string | undefined {
  if (releaseDirectories === null) {
    releaseDirectories = new Map();
    for (const parent of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'packages', 'modules')]) {
      for (const entry of readdirSync(parent)) {
        const manifestPath = join(parent, entry, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const declared = readJson<{ name?: string }>(manifestPath).name;
        if (typeof declared === 'string') releaseDirectories.set(declared, join(parent, entry));
      }
    }
  }
  return releaseDirectories.get(name);
}

/** Pack a release package of this checkout by name; cached per run. */
const packedReleasePackages = new Map<string, string>();
function packRelease(name: string, tarballDir: string): string {
  const cached = packedReleasePackages.get(name);
  if (cached !== undefined) return cached;
  const dir = releaseDirectoryOf(name);
  if (dir === undefined) refuse(`${name} is not a package of this checkout`);
  if (!existsSync(join(dir, 'dist'))) refuse(`${dir} has no dist — run \`pnpm run build:packages\` first`);
  const tarball = pack(dir, tarballDir);
  packedReleasePackages.set(name, tarball);
  return tarball;
}

/** The `@endora-commerce/*` names a manifest declares, in every dependency field. */
function scopedNames(manifest: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const name of Object.keys((manifest[field] ?? {}) as Record<string, string>)) {
      if (name.startsWith(SCOPE)) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Pin every `@endora-commerce/*` package a manifest reaches at a tarball packed
 * from this checkout — publication's stand-in, as in
 * `acceptance:storefront-scaffold`'s tarball route. The closure is walked
 * through each packed package's own dependencies and required peers, so an edge
 * no manifest in the instance names (page-builder-core → contracts) is pinned
 * too.
 */
function pinScopedPackages(
  target: string,
  tarballDir: string,
  roots: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): string[] {
  const overrides: Record<string, string> = { ...extra };
  const queue = [...roots];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (overrides[name] !== undefined || name === FIXTURE_PACKAGE || !name.startsWith(SCOPE)) continue;
    const tarball = packRelease(name, tarballDir);
    overrides[name] = `file:${tarball}`;
    const manifest = readJson<Record<string, unknown>>(join(releaseDirectoryOf(name)!, 'package.json'));
    const optional = (manifest['peerDependenciesMeta'] ?? {}) as Record<string, { optional?: boolean }>;
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const dependency of Object.keys((manifest[field] ?? {}) as Record<string, string>)) {
        if (!dependency.startsWith(SCOPE)) continue;
        if (field === 'peerDependencies' && optional[dependency]?.optional === true) continue;
        queue.push(dependency);
      }
    }
  }
  const manifestPath = join(target, 'package.json');
  const manifest = readJson<Record<string, unknown> & { pnpm?: { overrides?: Record<string, string> } }>(
    manifestPath,
  );
  manifest.pnpm = { ...manifest.pnpm, overrides: { ...manifest.pnpm?.overrides, ...overrides } };
  for (const field of ['dependencies', 'devDependencies']) {
    const declared = manifest[field] as Record<string, string> | undefined;
    if (declared === undefined) continue;
    for (const [name, spec] of Object.entries(overrides)) {
      if (declared[name] !== undefined) declared[name] = spec;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.keys(overrides).sort();
}

/** Copy the fixture out of the repository, install what it compiles against, build and pack it. */
function buildFixture(work: string, tarballDir: string): { dir: string; tarball: string } {
  const dir = join(work, 'fixture');
  cpSync(FIXTURE_SOURCE, dir, {
    recursive: true,
    filter: (source) => !/\/(node_modules|dist)(\/|$)/.test(source.slice(FIXTURE_SOURCE.length)),
  });

  // The copy compiles with the repository's compiler options and resolves
  // nothing through them: the fixture's own tsconfig clears `paths`.
  const tsconfigPath = join(dir, 'tsconfig.json');
  const tsconfig = readFileSync(tsconfigPath, 'utf8').replace(
    '"../../../tsconfig.base.json"',
    JSON.stringify(join(REPO_ROOT, 'tsconfig.base.json')),
  );
  writeFileSync(tsconfigPath, tsconfig);

  const storefront = readJson<{ dependencies: Record<string, string>; devDependencies: Record<string, string> }>(
    join(REPO_ROOT, 'storefront', 'package.json'),
  );
  const versionOf = (name: string): string => {
    const version = storefront.dependencies[name] ?? storefront.devDependencies[name];
    if (version === undefined) refuse(`the reference storefront declares no ${name} to build the fixture against`);
    return version;
  };
  const manifestPath = join(dir, 'package.json');
  const manifest = readJson<Record<string, unknown>>(manifestPath);
  // What a third-party author installs to build: the packages the fixture
  // peer-depends on, at this checkout's tarballs, and the toolchain.
  manifest['devDependencies'] = {
    ...Object.fromEntries(scopedNames(manifest).map((name) => [name, '*'])),
    '@puckeditor/core': versionOf('@puckeditor/core'),
    '@types/react': versionOf('@types/react'),
    react: versionOf('react'),
    typescript: versionOf('typescript'),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const pinned = pinScopedPackages(dir, tarballDir, scopedNames(manifest));
  notes.push(`the fixture was built outside the repository against tarballs of ${pinned.join(', ')}`);

  const install = run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: dir, timeout: 900_000 });
  if (install.code !== 0) refuse(`the fixture's own install failed:\n${install.output.slice(-2000)}`);
  const build = run('pnpm', ['run', 'build'], { cwd: dir, timeout: 600_000 });
  if (build.code !== 0) refuse(`the fixture did not build:\n${build.output.slice(-3000)}`);

  // The published manifest carries no build-time devDependencies.
  const built = readJson<Record<string, unknown>>(manifestPath);
  delete built['devDependencies'];
  delete built['pnpm'];
  writeFileSync(manifestPath, `${JSON.stringify(built, null, 2)}\n`);
  return { dir, tarball: pack(dir, tarballDir) };
}

/** The flags `endora new storefront` requires, from the reference storefront's own declaration. */
async function scaffoldInputs(): Promise<string[]> {
  const cli = (await import('@endora-commerce/cli')) as {
    envExampleDeclarationsOf: (dir: string) => ReadonlyMap<string, string>;
    flagFor: (name: string) => string;
    resolveReference: (cwd: string) => { dir: string };
    storefrontDeclaredInputs: (cwd: string) => Promise<readonly EnvironmentInput[]>;
  };
  const example = cli.envExampleDeclarationsOf(cli.resolveReference(REPO_ROOT).dir);
  const flags: string[] = [];
  for (const input of await cli.storefrontDeclaredInputs(REPO_ROOT)) {
    if (!isRequiredGiven(input, {})) continue;
    const value = example.get(input.name);
    if (value === undefined) {
      refuse(`the storefront requires ${input.name} and its .env.example declares no value for it`);
    }
    flags.push(cli.flagFor(input.name), value);
  }
  return flags;
}

const STOREFRONT_PROBE = `import { writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { PageBuilderRender } from '../components/PageBuilderRender';

// Written by the block-renderers acceptance runner. It renders through the
// storefront's own boundary and its own generated registry — nothing here names
// the fixture's renderer.
const badge = (id: string, text: string, explode = 'no') => ({
  type: 'acceptance_blocks.Badge',
  props: { id, text, explode },
});
const page = (content: unknown[]) => ({ root: { props: {} }, content, zones: {} });

function ssr(data: unknown, absent: string[], preview = false): string {
  const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToString(
      createElement(PageBuilderRender, { data, presence: { absent }, language: 'en-US', preview }),
    );
  } finally {
    silence.mockRestore();
  }
}

it('renders the fixture block through the storefront', () => {
  const stored = page([badge('b1', 'Gold')]);
  const documentBefore = JSON.stringify(stored);
  const result = {
    present: ssr(stored, []),
    absent: ssr(stored, ['acceptance_blocks']),
    absentPreview: ssr(stored, ['acceptance_blocks'], true),
    presentAgain: ssr(stored, []),
    exploding: ssr(
      page([badge('s1', 'Before'), badge('x1', 'Exploding', 'yes'), badge('s2', 'After')]),
      [],
    ),
    documentBefore,
    documentAfter: JSON.stringify(stored),
  };
  writeFileSync(process.env.BLOCK_RENDERERS_PROBE_OUT as string, JSON.stringify(result));
  expect(result.present.length).toBeGreaterThan(0);
});
`;

const EMAIL_PROBE = `import { writeFileSync } from 'node:fs';
import { emailBlocks } from '@endora-commerce/mod-acceptance-blocks/email';
import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
import { renderEmailText } from '@endora-commerce/email-components/render/render-email-text';

// Written by the block-renderers acceptance runner: the packed e-mail layer,
// drawn by the installed e-mail renderer — the function the send path runs.
const badge = (id, text, explode = 'no') => ({ type: 'acceptance_blocks.Badge', props: { id, text, explode } });
const tree = (content) => ({ root: { props: {} }, content, zones: {} });
const one = tree([badge('b1', 'Gold')]);
const three = tree([badge('s1', 'Before'), badge('x1', 'Exploding', 'yes'), badge('s2', 'After')]);
const reported = [];
const onBlockError = (name) => reported.push(name);

writeFileSync(
  process.argv[2],
  JSON.stringify({
    html: renderEmailHtml(one, { document: false, blockRenderers: emailBlocks }),
    text: renderEmailText(one, { blockRenderers: emailBlocks }),
    htmlWithoutRenderers: renderEmailHtml(one, { document: false }),
    explodingHtml: renderEmailHtml(three, { document: false, blockRenderers: emailBlocks, onBlockError }),
    explodingText: renderEmailText(three, { blockRenderers: emailBlocks, onBlockError }),
    reported,
  }),
);
`;

/** Run one phase of a probe in its own platform process and read its one verdict line. */
function probePhase<T>(script: string, phase: string, env: NodeJS.ProcessEnv): T | { failure: string } {
  const result = run(join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx'), [join(SCRIPT_DIR, script), phase], {
    cwd: BACKEND_ROOT,
    env,
    timeout: 600_000,
  });
  const line = result.output
    .split('\n')
    .reverse()
    .find((entry) => entry.startsWith('ACCEPTANCE_JSON '));
  if (line === undefined) {
    return { failure: `the ${phase} phase printed no verdict (exit ${String(result.code)}): ${result.output.slice(-600)}` };
  }
  const payload = JSON.parse(line.slice('ACCEPTANCE_JSON '.length)) as {
    inconclusive?: string;
    phaseError?: string;
  } & T;
  if (payload.inconclusive !== undefined) refuse(`${phase}: ${payload.inconclusive.slice(0, 800)}`);
  if (payload.phaseError !== undefined) return { failure: `${phase} threw: ${payload.phaseError.slice(0, 800)}` };
  return payload;
}

const ADMIN_EMAIL = 'acceptance@endora.test';
const ADMIN_PASSWORD = 'Acceptance-Blocks-1!';

/**
 * The platform half: the package installed from its tarball into a directory
 * outside the repository, the real composition root booted against it
 * (`ENDORA_INSTANCE_ROOT`, `acceptance:package-schema`'s arrangement), and the
 * module switched on, off and on again — one platform process per state.
 */
async function measurePlatform(
  work: string,
  fixtureTarball: string,
): Promise<{ on: PlatformObservation | null; off: PlatformObservation | null; again: PlatformObservation | null }> {
  let addresses: Record<string, string>;
  try {
    addresses = explicitServiceAddresses(process.env, ['ACCEPTANCE_DATABASE_URL', 'REDIS_URL']);
  } catch (error: unknown) {
    if (error instanceof MissingServiceAddressError) refuse(error.message);
    throw error;
  }
  const target = resolveDatabaseTarget(addresses['ACCEPTANCE_DATABASE_URL']!);
  if ('error' in target) refuse(target.error);

  const instance = join(work, 'platform-instance');
  installInto(instance, fixtureTarball);
  // Host-provided peers, linked so the package and the platform share one copy
  // of each — what an instance's own install gives a module package.
  const scope = join(instance, 'node_modules', '@endora-commerce');
  mkdirSync(scope, { recursive: true });
  for (const peer of ['platform', 'contracts', 'email-components', 'page-builder-core']) {
    const link = join(scope, peer);
    if (!existsSync(link)) symlinkSync(join(REPO_ROOT, 'packages', peer), link, 'dir');
  }

  await resetDatabase(target.databaseUrl, target.adminUrl, target.databaseName);
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: target.databaseUrl,
    REDIS_URL: addresses['REDIS_URL']!,
    ACCEPTANCE_INSTANCE_ROOT: instance,
    ENDORA_INSTANCE_ROOT: instance,
    ACCEPTANCE_PACKAGE_NAME: FIXTURE_PACKAGE,
    ACCEPTANCE_MODULE_ID: FIXTURE_MODULE_ID,
    ACCEPTANCE_STATE_FILE: join(work, 'platform-state.json'),
    ACCEPTANCE_ADMIN_EMAIL: ADMIN_EMAIL,
    ACCEPTANCE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    NODE_ENV: 'test',
    SESSION_COOKIE_SECRET: 'acceptance-secret',
    PUBLIC_API_BASE_URL: process.env['PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001',
    BACKEND_RUN_WORKERS: 'false',
  };
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  const migrate = run(tsx, ['src/db/migrate.ts', 'up'], { cwd: BACKEND_ROOT, env, timeout: 600_000 });
  if (migrate.code !== 0) refuse(`the acceptance database did not migrate:\n${migrate.output.slice(-1500)}`);

  for (const [script, phase] of [
    ['block-renderers-probe.ts', 'boot'],
    ['instance-probe.ts', 'install'],
  ] as const) {
    const outcome = probePhase<Record<string, unknown>>(script, phase, env);
    if ('failure' in outcome) refuse(String(outcome.failure));
  }
  const created = run(
    tsx,
    [
      'src/cli.ts',
      'admin_users',
      'create',
      `--email=${ADMIN_EMAIL}`,
      `--password=${ADMIN_PASSWORD}`,
      '--first-name=Acceptance',
      '--last-name=Run',
    ],
    { cwd: BACKEND_ROOT, env, timeout: 300_000 },
  );
  if (created.code !== 0) refuse(`the administrator could not be created:\n${created.output.slice(-1500)}`);

  const observe = (phase: string): PlatformObservation | null => {
    const outcome = probePhase<{ observation: PlatformObservation }>('block-renderers-probe.ts', phase, env);
    if ('failure' in outcome) {
      notes.push(String(outcome.failure));
      return null;
    }
    return outcome.observation;
  };
  const on = observe('render-on');
  const off = observe('render-off');
  const again = observe('render-on');
  notes.push(`the platform half ran against ${target.databaseName}, with the package installed in ${instance}`);
  return { on, off, again };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Where a package installed in the instance resolves a specifier from, as a real path. */
function resolveFromPackage(packageDir: string, specifier: string): string {
  return createRequire(join(realpathSync(packageDir), 'noop.js')).resolve(specifier);
}

const ADMIN_PROBE = (paths: Record<string, string>): string => `import { readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render } from ${JSON.stringify(paths['puck'])};
import { defaultPageBuilderConfig, withMissingBlockPlaceholders } from ${JSON.stringify(paths['cmsComponents'])};
import { composeDeclaredBlocks, loadBlockEditors, namesToLoad } from ${JSON.stringify(paths['cmsComposition'])};
import { composeEmailBlocks, loadEmailBlockRenderers } from ${JSON.stringify(paths['emailComposition'])};
import { MODULE_ADMIN_CONTRIBUTIONS } from './src/modules.generated';

// Written by the block-renderers acceptance runner and bundled by this
// instance's own Vite. The registry is the one 'endora generate' wrote here;
// the composition is the admin's own, as the installed packages ship it; the
// descriptors are what the composed platform served with the module on and off.
const BLOCK = 'acceptance_blocks.Badge';
const [out, descriptorsPath] = process.argv.slice(2);
const descriptors = JSON.parse(readFileSync(descriptorsPath, 'utf8'));
const badge = (id, text, explode = 'no') => ({ type: BLOCK, props: { id, text, explode } });
const page = (content) => ({ root: { props: {} }, content, zones: {} });
const stored = page([badge('b1', 'Gold')]);
const documentBefore = JSON.stringify(stored);

const owned = MODULE_ADMIN_CONTRIBUTIONS.flatMap((entry) =>
  (entry.contributions.blocks ?? []).map((block) => ({ ...block, module: entry.moduleId })),
);
const base = defaultPageBuilderConfig.components ?? {};
const silence = () => { const original = console.error; console.error = () => undefined; return () => { console.error = original; }; };
const draw = (components, data) => {
  const restore = silence();
  try { return renderToString(createElement(Render, { config: { components }, data })); } finally { restore(); }
};

async function compose(entry) {
  const declared = entry === null ? [] : [entry];
  const loaded = await loadBlockEditors(
    owned.filter((block) => block.context === 'cms'),
    namesToLoad(declared, base),
  );
  return composeDeclaredBlocks({
    components: base,
    declared,
    editors: loaded.editors,
    owners: loaded.owners,
    previewSentence: 'no preview',
  });
}

// In a function, not at the top level: a contribution's factory is a dynamic
// import of a chunk that imports this entry back, and an entry still awaiting
// at its top level never finishes evaluating for that chunk to load.
async function main() {
const on = await compose(descriptors.on);
const off = await compose(descriptors.off);
const again = await compose(descriptors.again);
const offDegraded = withMissingBlockPlaceholders({ components: off }, [BLOCK]).components;

const emailLoaded = await loadEmailBlockRenderers(
  owned.filter((block) => block.context === 'email'),
  new Set([BLOCK]),
);
const email = composeEmailBlocks({
  components: {},
  declared: descriptors.on === null ? [] : [descriptors.on],
  renderers: emailLoaded.renderers,
  owners: emailLoaded.owners,
  previewSentence: 'no preview',
  language: 'en-US',
});
const canvas = email.components[BLOCK];

writeFileSync(
  out,
  JSON.stringify({
    registryModules: [...new Set(owned.map((block) => block.module))],
    cmsOn: draw(on, stored),
    cmsFields: Object.keys(on[BLOCK]?.fields ?? {}),
    cmsOff: draw(offDegraded, stored),
    cmsOffInsertable: Object.hasOwn(off, BLOCK),
    cmsAgain: draw(again, stored),
    cmsExploding: draw(on, page([badge('s1', 'Before'), badge('x1', 'Exploding', 'yes'), badge('s2', 'After')])),
    emailCanvas: canvas === undefined ? '' : renderToString(createElement(canvas.render, { id: 'b1', text: 'Gold' })),
    documentBefore,
    documentAfter: JSON.stringify(stored),
  }),
);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`;

const ADMIN_PROBE_CONFIG = `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The acceptance probe's own build: everything bundled, so the packages'
// stylesheet imports and TypeScript are handled by Vite as in the admin build.
export default defineConfig({
  plugins: [react()],
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: { ssr: 'acceptance-probe.tsx', outDir: '.acceptance-probe', emptyOutDir: true },
});
`;

/**
 * The admin half: an instance scaffolded by `endora new instance` with the
 * fixture among its modules, installed from tarballs, generated and built —
 * and a probe, bundled by that instance's own Vite, that composes the editors
 * from the instance's generated registry.
 */
async function measureAdmin(
  work: string,
  tarballDir: string,
  fixture: { dir: string; tarball: string },
  descriptors: { on: unknown; off: unknown; again: unknown },
): Promise<{ build: Parameters<typeof evaluateA2>[0] | null; probe: AdminProbe | null }> {
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  const endora = join(REPO_ROOT, 'packages', 'cli', 'src', 'bin', 'endora.ts');

  // `endora new instance` reads the release it writes from the packages
  // installed beside it. The host is that: every package of this checkout and
  // the built fixture, by name.
  const host = join(work, 'host');
  const hostScope = join(host, 'node_modules', '@endora-commerce');
  mkdirSync(hostScope, { recursive: true });
  writeFileSync(join(host, 'package.json'), '{"name":"acceptance-host","private":true}\n');
  releaseDirectoryOf('@endora-commerce/platform');
  const moduleIds: string[] = [FIXTURE_MODULE_ID];
  for (const [name, dir] of releaseDirectories!) {
    if (!name.startsWith(SCOPE)) continue;
    symlinkSync(dir, join(hostScope, name.slice(SCOPE.length)), 'dir');
    const endoraBlock = readJson<{ endora?: { type?: string; id?: string } }>(join(dir, 'package.json')).endora;
    if (endoraBlock?.type === 'module' && typeof endoraBlock.id === 'string') moduleIds.push(endoraBlock.id);
  }
  symlinkSync(fixture.dir, join(hostScope, FIXTURE_PACKAGE.slice(SCOPE.length)), 'dir');

  const instance = join(work, 'instance');
  const scaffold = run(
    tsx,
    [endora, 'new', 'instance', instance, '--without', 'docs', ...moduleIds.sort().flatMap((id) => ['--module', id])],
    { cwd: host },
  );
  if (scaffold.code !== 0) refuse(`\`endora new instance\` exited ${String(scaffold.code)}:\n${scaffold.output.slice(-2000)}`);

  if (!scopedNames(readJson(join(instance, 'package.json'))).includes(FIXTURE_PACKAGE)) {
    refuse('the scaffolded instance does not declare the fixture module');
  }

  // Publication's stand-in for an instance is a registry, not an overrides
  // block: a module package names its optional peers by range, and a range
  // rewritten to a tarball is one pnpm reports unmet instead of linking — the
  // admin build then cannot resolve `page-builder-core` from a module that
  // imports it. The registry serves every package of this checkout and the
  // fixture at the versions the scaffold wrote, and forwards the rest.
  const served = [...releaseDirectories!.keys()]
    .filter((name) => name.startsWith(SCOPE) || name === 'create-endora-commerce')
    .map((name) => packRelease(name, tarballDir));
  const tarballs = [...served, fixture.tarball].map((file) => tarballFrom(file, readFileSync(file)));
  let registry: LocalRegistry | null = null;
  let build: { code: number; output: string };
  try {
    registry = await startLocalRegistry({ tarballs, upstream: 'https://registry.npmjs.org' });
    const env = registryEnvironment(registry.url, join(work, 'registry-scratch'));
    notes.push(
      `the instance was scaffolded into ${instance} with ${String(moduleIds.length)} modules and installed from a ` +
        `local registry serving ${String(tarballs.length)} packed packages`,
    );
    const install = await runAsync('pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: instance,
      env,
      timeout: 1_200_000,
    });
    if (install.code !== 0) refuse(`the instance's own install failed:\n${install.output.slice(-2000)}`);
    build = await runAsync('pnpm', ['run', 'build:admin'], { cwd: instance, env, timeout: 1_200_000 });
  } finally {
    if (registry !== null) await registry.close();
  }
  const adminDir = join(instance, 'admin');
  const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');
  const dist = join(adminDir, 'dist');
  const bundleHasMarker =
    existsSync(dist) &&
    walk(dist).some((file) => file.endsWith('.js') && readFileSync(file, 'utf8').includes(MARKER));
  const observation = {
    registry: read(join(adminDir, 'src', 'modules.generated.ts')),
    stylesheet: read(join(adminDir, 'src', 'tailwind.generated.css')),
    buildExitCode: build.code,
    buildOutput: build.output,
    bundleHasMarker,
  };
  if (build.code !== 0) return { build: observation, probe: null };

  // The probe imports the admin's own composition as the installed packages
  // ship it. Two of those files are not behind a public subpath, so they are
  // named by path — a probe may; a module may not.
  const cmsPackage = join(instance, 'node_modules', '@endora-commerce', 'mod-cms');
  const pageBuilderAdmin = dirname(dirname(resolveFromPackage(cmsPackage, '@endora-commerce/page-builder-admin')));
  writeFileSync(
    join(adminDir, 'acceptance-probe.tsx'),
    ADMIN_PROBE({
      puck: resolveFromPackage(cmsPackage, '@puckeditor/core'),
      cmsComponents: resolveFromPackage(cmsPackage, '@endora-commerce/cms-components'),
      cmsComposition: join(realpathSync(cmsPackage), 'dist', 'admin', 'components', 'block-contributions.js'),
      emailComposition: join(pageBuilderAdmin, 'dist', 'email', 'email-block-editor-config.js'),
    }),
  );
  writeFileSync(join(adminDir, 'vite.acceptance.config.ts'), ADMIN_PROBE_CONFIG);
  const descriptorsPath = join(work, 'descriptors.json');
  writeFileSync(descriptorsPath, JSON.stringify(descriptors));
  const bundle = run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.acceptance.config.ts'], {
    cwd: adminDir,
    timeout: 900_000,
    env: { NODE_ENV: undefined },
  });
  const out = join(work, 'admin-probe.json');
  let probeRun = bundle;
  if (bundle.code === 0) {
    probeRun = run('node', [join('.acceptance-probe', 'acceptance-probe.js'), out, descriptorsPath], {
      cwd: adminDir,
      timeout: 300_000,
    });
  }
  const probe = existsSync(out) ? readJson<AdminProbe>(out) : null;
  if (probe === null) {
    notes.push(`the admin probe wrote nothing: ${probeRun.output.trim().split('\n').slice(-10).join(' / ').slice(0, 1500)}`);
  }
  return { build: observation, probe };
}

async function main(): Promise<void> {
  const againstExpectation = process.argv.includes('--against-expectation');
  const keep = process.argv.includes('--keep');
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) refuse(`${tsx} is missing — run \`pnpm install\` first`);
  const endora = join(REPO_ROOT, 'packages', 'cli', 'src', 'bin', 'endora.ts');

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'endora-block-renderers-')));
  if (work.startsWith(REPO_ROOT)) refuse(`${work} is inside the repository`);
  workDirectory = work;
  const tarballDir = join(work, 'tarballs');
  mkdirSync(tarballDir);

  // ── the fixture, built and packed outside the repository ───────────────────
  const fixture = buildFixture(work, tarballDir);

  // A1 — what the tarball publishes, and what `endora check` says of the package.
  const unpacked = join(work, 'unpacked');
  mkdirSync(unpacked);
  const untar = run('tar', ['-xzf', fixture.tarball, '-C', unpacked], { cwd: work });
  if (untar.code !== 0) refuse(`the fixture's tarball could not be read:\n${untar.output}`);
  const listed = run('tar', ['-tzf', fixture.tarball], { cwd: work });
  const check = run(tsx, [endora, 'check'], { cwd: fixture.dir, timeout: 300_000 });
  const results: AssertionResult[] = [
    evaluateA1({
      exports: readJson<{ exports: Record<string, unknown> }>(join(unpacked, 'package', 'package.json')).exports,
      files: listed.output.split('\n').map((line) => line.replace(/^package\//, '')).filter(Boolean),
      checkVerdict: checkVerdictOf(check.output, 'check:block-renderers'),
    }),
  ];

  // ── the composed platform, then the instance's admin over what it served ───
  const platform = await measurePlatform(work, fixture.tarball);
  const admin = await measureAdmin(work, tarballDir, fixture, {
    on: platform.on?.descriptorEntry ?? null,
    off: platform.off?.descriptorEntry ?? null,
    again: platform.again?.descriptorEntry ?? null,
  });
  results.push(
    admin.build === null
      ? { id: 'A2', state: 'fail', detail: 'the instance admin was not built' }
      : evaluateA2(admin.build),
    evaluateA3(admin.probe, platform.on),
  );

  // ── the storefront ────────────────────────────────────────────────────────
  const shop = join(work, 'shop');
  const scaffold = run(
    tsx,
    [endora, 'new', 'storefront', shop, '--non-interactive', ...(await scaffoldInputs())],
    { cwd: REPO_ROOT },
  );
  if (scaffold.code !== 0) refuse(`\`endora new storefront\` exited ${String(scaffold.code)}:\n${scaffold.output}`);

  const shopManifestPath = join(shop, 'package.json');
  const shopManifest = readJson<Record<string, unknown> & { dependencies: Record<string, string> }>(
    shopManifestPath,
  );
  // What a storefront owner does: add the module package. Nothing else.
  shopManifest.dependencies[FIXTURE_PACKAGE] = `file:${fixture.tarball}`;
  // This harness's own need, and not something a storefront owner does: the
  // e-mail probe below imports the e-mail renderer from this directory. A peer
  // range pinned to a tarball is not auto-installed, so it is declared.
  shopManifest['devDependencies'] = {
    ...((shopManifest['devDependencies'] ?? {}) as Record<string, string>),
    [`${SCOPE}email-components`]: '*',
  };
  writeFileSync(shopManifestPath, `${JSON.stringify(shopManifest, null, 2)}\n`);
  // The probe below runs under the scaffold's own vitest, on whichever Vite its
  // range resolves here — nothing is pinned, so the runner is the one a
  // storefront owner gets.
  const fixtureManifest = readJson<Record<string, unknown>>(join(unpacked, 'package', 'package.json'));
  const pinned = pinScopedPackages(shop, tarballDir, [
    ...scopedNames(shopManifest),
    ...scopedNames(fixtureManifest).filter((name) => {
      const meta = (fixtureManifest['peerDependenciesMeta'] ?? {}) as Record<string, { optional?: boolean }>;
      return meta[name]?.optional !== true;
    }),
  ]);
  notes.push(`the storefront was scaffolded into ${shop} and pinned ${pinned.join(', ')} to tarballs`);

  const install = run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: shop, timeout: 900_000 });
  if (install.code !== 0) refuse(`the storefront's own install failed:\n${install.output.slice(-2000)}`);

  const generate = run('pnpm', ['run', 'blocks:generate'], { cwd: shop });
  if (generate.code !== 0) refuse(`blocks:generate failed in the scaffold:\n${generate.output}`);
  const build = run('pnpm', ['run', 'build'], {
    cwd: shop,
    timeout: 900_000,
    // The scaffold's own `.env` is what Next reads; nothing of this harness's.
    env: { NODE_ENV: undefined },
  });

  const probeOut = join(work, 'storefront-probe.json');
  writeFileSync(join(shop, 'test', 'acceptance-block-renderers.probe.test.tsx'), STOREFRONT_PROBE);
  const probeRun = run('pnpm', ['exec', 'vitest', 'run', 'test/acceptance-block-renderers.probe.test.tsx'], {
    cwd: shop,
    timeout: 300_000,
    env: { BLOCK_RENDERERS_PROBE_OUT: probeOut, NODE_ENV: undefined },
  });
  const storefrontProbe = existsSync(probeOut) ? readJson<StorefrontProbe>(probeOut) : null;
  if (storefrontProbe === null) {
    notes.push(`the storefront probe wrote nothing: ${probeRun.output.trim().split('\n').slice(-8).join(' / ')}`);
  }

  results.push(
    evaluateA4({
      registry: readFileSync(join(shop, 'lib', 'page-builder', 'blocks.generated.ts'), 'utf8'),
      stylesheet: readFileSync(join(shop, 'app', 'blocks.generated.css'), 'utf8'),
      buildExitCode: build.code,
      buildOutput: build.output,
      probe: storefrontProbe,
    }),
  );

  // ── e-mail, through the installed tarballs ─────────────────────────────────
  const emailOut = join(work, 'email-probe.json');
  writeFileSync(join(shop, 'acceptance-email-probe.mjs'), EMAIL_PROBE);
  const emailRun = run('node', ['acceptance-email-probe.mjs', emailOut], { cwd: shop, timeout: 60_000 });
  const emailProbe = existsSync(emailOut) ? readJson<EmailProbe>(emailOut) : null;
  if (emailProbe === null) {
    notes.push(`the e-mail probe wrote nothing: ${emailRun.output.trim().split('\n').slice(-8).join(' / ')}`);
  }

  results.push(
    evaluateA5Package(emailProbe),
    evaluateA5Platform(platform.on),
    evaluateA6Storefront(storefrontProbe),
    evaluateA6Email(platform.off),
    evaluateA6Admin(admin.probe, platform.off),
    evaluateA7Storefront(storefrontProbe),
    evaluateA7Email(platform.on, platform.off, platform.again),
    evaluateA7Admin(admin.probe, platform.again),
    evaluateA8Storefront(storefrontProbe),
    evaluateA8Package(emailProbe),
    evaluateA8Platform(platform.on),
    evaluateA8Admin(admin.probe),
  );
  results.sort((left, right) => left.id.localeCompare(right.id));

  for (const result of results) {
    console.log(`${PREFIX} ${result.id} ${result.state.toUpperCase()} — ${result.detail}`);
  }
  for (const note of notes) console.log(`${PREFIX} note: ${note}`);
  const count = (state: string): number => results.filter((result) => result.state === state).length;
  console.log(
    `${PREFIX} pass=${String(count('pass'))} fail=${String(count('fail'))} ` +
      `unmeasured=${String(count('unmeasured'))} of ${String(results.length)}`,
  );

  if (keep) console.log(`${PREFIX} kept ${work}`);
  else rmSync(work, { recursive: true, force: true });

  if (!againstExpectation) {
    armExitWatchdog(exitCodeFor(results));
    return;
  }

  const drift = compareToExpectation(results, readJson<AcceptanceExpectation>(EXPECTATION_FILE), 'tarball');
  for (const line of drift) console.error(`${PREFIX} drift: ${line}`);
  console.log(
    drift.length === 0
      ? `${PREFIX} the run agrees with ${EXPECTATION_FILE}`
      : `${PREFIX} the run drifted from ${EXPECTATION_FILE} — record the move in the change that earned it`,
  );
  armExitWatchdog(exitCodeForExpectation(drift));
}

await main();
