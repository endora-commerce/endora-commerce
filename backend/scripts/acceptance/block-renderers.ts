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
 * ## What it measures, and what it says it does not
 *
 * A1, A4, the storefront halves of A6–A8, the package half of A5 and the
 * e-mail half of A8. **A2, A3, the composed-platform half of A5 and the admin
 * and e-mail halves of A6–A7 are reported `unmeasured`, each with its reason**
 * — they need a scaffolded instance, a Vite build and a platform process with a
 * database, which this runner does not stand up. They are printed, never
 * absent: an assertion nobody mentions is the silent skip this estate exists
 * against. A plain run therefore exits **2**; `--against-expectation` compares
 * to `backend/acceptance/block-renderers-expected-state.json`, which records
 * those assertions as unmeasured, and fails on drift in either direction.
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

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

import {
  checkVerdictOf,
  evaluateA1,
  evaluateA4,
  evaluateA5Package,
  evaluateA6Storefront,
  evaluateA7Storefront,
  evaluateA8Email,
  evaluateA8Storefront,
  FIXTURE_PACKAGE,
  unmeasured,
  type EmailProbe,
  type StorefrontProbe,
} from './block-renderers-assertions.js';
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

function refuse(message: string): never {
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

/** Pack a release package of this checkout by name; cached per run. */
const packedReleasePackages = new Map<string, string>();
function packRelease(name: string, tarballDir: string): string {
  const cached = packedReleasePackages.get(name);
  if (cached !== undefined) return cached;
  const dir = join(REPO_ROOT, 'packages', name.slice(SCOPE.length));
  if (!existsSync(join(dir, 'package.json'))) refuse(`${name} is not a package of this checkout`);
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
function pinScopedPackages(target: string, tarballDir: string, roots: readonly string[]): string[] {
  const overrides: Record<string, string> = {};
  const queue = [...roots];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (overrides[name] !== undefined || name === FIXTURE_PACKAGE) continue;
    if (name.startsWith(`${SCOPE}mod-`)) continue;
    const tarball = packRelease(name, tarballDir);
    overrides[name] = `file:${tarball}`;
    const manifest = readJson<Record<string, unknown>>(
      join(REPO_ROOT, 'packages', name.slice(SCOPE.length), 'package.json'),
    );
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

const NOT_MEASURED: Readonly<Record<string, string>> = {
  A2:
    'needs a scaffolded instance with the fixture installed, `endora generate` and a Vite build of ' +
    'its admin; this runner stands up no instance',
  A3:
    "needs the admin's editor composition built from that instance's generated registry; the " +
    'composition itself is held in-repository by `admin/test/modules/cms/block-contributions.test.tsx`',
  'A5-platform':
    'needs a composed platform process and a database to render a transactional preview and a ' +
    'newsletter; the registry and both send paths are held in-repository by their unit tests',
  'A6-email-admin':
    'needs an activation flip in a composed platform and the admin editors; the skip policy and ' +
    'the placeholder merge are held in-repository by their unit tests',
  'A7-email-admin': 'as A6: the restore after a flip needs a composed platform',
  'A8-admin':
    "needs the admin's editor composition; the boundary is held in-repository by " +
    '`block-boundary.test.tsx` and `block-contributions.test.tsx`',
};

async function main(): Promise<void> {
  const againstExpectation = process.argv.includes('--against-expectation');
  const keep = process.argv.includes('--keep');
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) refuse(`${tsx} is missing — run \`pnpm install\` first`);
  const endora = join(REPO_ROOT, 'packages', 'cli', 'src', 'bin', 'endora.ts');

  const work = realpathSync(mkdtempSync(join(tmpdir(), 'endora-block-renderers-')));
  if (work.startsWith(REPO_ROOT)) refuse(`${work} is inside the repository`);
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
    unmeasured('A2', NOT_MEASURED['A2']!),
    unmeasured('A3', NOT_MEASURED['A3']!),
  ];

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
  // The probe below runs under the scaffold's own vitest. An unpinned install
  // resolves the newest Vite that vitest's range admits, and under Vite 8 the
  // storefront's vitest configuration (`esbuild.jsx`) no longer transforms JSX —
  // every `.tsx` test of a fresh scaffold fails to parse. That is a defect of
  // the scaffold and not this criterion's subject, so the harness pins Vite to
  // the version this checkout's own storefront tests run on, and says so.
  const viteVersion = readJson<{ version: string }>(
    createRequire(realpathSync(join(REPO_ROOT, 'storefront', 'node_modules', 'vitest', 'package.json'))).resolve(
      'vite/package.json',
    ),
  ).version;
  shopManifest['pnpm'] = {
    ...((shopManifest['pnpm'] ?? {}) as Record<string, unknown>),
    overrides: {
      ...(((shopManifest['pnpm'] ?? {}) as { overrides?: Record<string, string> }).overrides ?? {}),
      vite: viteVersion,
    },
  };
  writeFileSync(shopManifestPath, `${JSON.stringify(shopManifest, null, 2)}\n`);
  notes.push(
    `the scaffold's vite was pinned to ${viteVersion}, the version this checkout's storefront tests ` +
      'run on: an unpinned install resolves Vite 8, under which the scaffold\'s vitest configuration ' +
      'does not transform JSX — a scaffold defect outside this criterion',
  );
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
    unmeasured('A5-platform', NOT_MEASURED['A5-platform']!),
    evaluateA6Storefront(storefrontProbe),
    unmeasured('A6-email-admin', NOT_MEASURED['A6-email-admin']!),
    evaluateA7Storefront(storefrontProbe),
    unmeasured('A7-email-admin', NOT_MEASURED['A7-email-admin']!),
    evaluateA8Storefront(storefrontProbe),
    evaluateA8Email(emailProbe),
    unmeasured('A8-admin', NOT_MEASURED['A8-admin']!),
  );

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

  if (!againstExpectation) process.exit(exitCodeFor(results));

  const drift = compareToExpectation(results, readJson<AcceptanceExpectation>(EXPECTATION_FILE), 'tarball');
  for (const line of drift) console.error(`${PREFIX} drift: ${line}`);
  console.log(
    drift.length === 0
      ? `${PREFIX} the run agrees with ${EXPECTATION_FILE}`
      : `${PREFIX} the run drifted from ${EXPECTATION_FILE} — record the move in the change that earned it`,
  );
  process.exit(exitCodeForExpectation(drift));
}

await main();
