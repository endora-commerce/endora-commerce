/**
 * The acceptance criterion for "a package can ship schema" (D-110, feature 080).
 *
 * ## What it does, and why it is not a test in `backend/test/`
 *
 * It builds a synthetic third-party module into a tarball, installs that
 * tarball into a throwaway directory **outside this repository**, and then asks
 * the platform whether the package's entity and migration reached a real
 * PostgreSQL database. Every step exists to leave the monorepo:
 *
 *   - the fixture's sources are not a `pnpm-workspace.yaml` member, so pnpm
 *     cannot link them;
 *   - the published artefact carries `dist` and `i18n` only, with comments
 *     stripped, so a source-text probe for `@Entity(` finds nothing;
 *   - the instance directory is under `os.tmpdir()`, so no relative specifier
 *     from `backend/src/db/` can reach it.
 *
 * A vitest file could do none of that honestly: the harness composes the
 * platform from the repository tree it lives in, which is the trap the contract
 * opens by naming — a moved directory satisfies almost everything a real
 * package does.
 *
 * ## Exit codes
 *
 *   0 — the criterion is met.
 *   1 — the criterion is red: something was measured and the platform failed it.
 *   2 — it could not be measured. Never a green, never a red.
 *
 * ## Today
 *
 * All nine pass (feature 080, T046): the criterion is met. It was red on
 * purpose for the length of Wave 3, and `acceptance/expected-state.json` carries
 * the history of each move plus what every pass now means. A8 and A9 passed
 * throughout, which is the point of them — they are the two assertions that
 * measure the *harness* rather than the platform, and if they could not pass
 * while everything else was red they would never be trusted now.
 *
 * Contract: `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.
 * Usage: `pnpm --filter backend run acceptance:package-schema`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyResolutionPath,
  compareToExpectation,
  exitCodeForExpectation,
  type AcceptanceExpectation,
  evaluateA8,
  evaluateA9,
  exitCodeFor,
  formatReport,
  instanceIsOutsideRepository,
  mergeResults,
  resolveDatabaseTarget,
  type AssertionResult,
} from './assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const FIXTURE_DIR = join(BACKEND_ROOT, 'acceptance', 'fixture-package');
const PACKAGE_NAME = '@endora-commerce/mod-acceptance-probe';
const DEFAULT_DSN = 'postgresql://b2b:b2b@localhost:5432/b2b_acceptance_test';
const EXPECTATION_FILE = join(BACKEND_ROOT, 'acceptance', 'expected-state.json');

/**
 * Strings that must not survive into the published artefact.
 *
 * **`'@endora-commerce/'` was a member of this list and cannot be one any more**
 * (feature 080, T042a). It meant *"the workspace's scope, so a specifier that
 * resolves into this repository"* — and since T042e that is also the scope of
 * the fixture's own name, of the host package it now legitimately peer-depends
 * on, and of every module package that will ever exist. One needle cannot mean
 * "the workspace's scope" and "not this package's own dependencies" at the same
 * time; it passed until this merge request only because nothing the fixture
 * emitted happened to name the scope.
 *
 * What it was approximating is asserted directly instead, by
 * {@link undeclaredSpecifiers}: **every bare specifier in the artefact is one
 * the fixture's own manifest declares**. That is the property — an installed
 * package reaches what its manifest says the instance must supply, and nothing
 * else — and it is stronger in both directions. `@endora-commerce/contracts`
 * would still be refused, because the fixture declares no such dependency; a
 * stray `fastify` in a package that had stopped declaring it would be refused,
 * which the scope needle never saw; and `@endora-commerce/platform` passes
 * exactly because it is declared, which is what makes it different from a reach
 * into the tree.
 *
 * The two that remain are literal text with no legitimate spelling: `@Entity(`
 * is the decorated **source** the composer's tree walk looks for, and
 * `backend/src` is a path into the repository that hosts the fixture.
 */
const ARTEFACT_MUST_NOT_CONTAIN = ['@Entity(', 'backend/src'] as const;

const notes: string[] = [];

function refuse(message: string): never {
  console.error(`[acceptance] cannot measure: ${message}`);
  console.error('[acceptance] exit 2 — this is neither a pass nor a failure of the criterion.');
  process.exit(2);
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; quiet?: boolean },
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) refuse(`${command} could not be run: ${result.error.message}`);
  if (!options.quiet && result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
  }
  return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A workspace binary, wherever pnpm put it: a dependency declared by `backend`
 * lands in `backend/node_modules/.bin`, one declared at the root lands in the
 * root's. Looking in one place only is how a runner reports "not installed"
 * about something that is.
 */
function binary(name: string): string {
  for (const root of [BACKEND_ROOT, REPO_ROOT]) {
    const candidate = join(root, 'node_modules', '.bin', name);
    if (existsSync(candidate)) return candidate;
  }
  refuse(`node_modules/.bin/${name} is missing — run \`pnpm install\` first`);
}

function walkFiles(root: string, out: string[] = []): string[] {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The procedure
// ---------------------------------------------------------------------------

/**
 * Every bare specifier in the built artefact that the fixture's own manifest
 * does not declare — see {@link ARTEFACT_MUST_NOT_CONTAIN} for why this replaced
 * a scope needle.
 *
 * Read as syntax rather than by regex (`ts.preProcessFile` is TypeScript's own
 * scanner-level import reader), so a string that happens to contain the word
 * `import` is out of the population by construction. Node builtins are not
 * declared by anybody and the package's own name is a self-reference, which
 * Node resolves through the package's own `exports` map.
 */
async function undeclaredSpecifiers(
  files: readonly string[],
  manifest: { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> },
): Promise<{ readonly findings: string[]; readonly seen: number }> {
  const ts = (await import('typescript')).default;
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const findings: string[] = [];
  let seen = 0;
  for (const file of files) {
    if (!/\.(js|mjs|cjs|d\.ts)$/.test(file)) continue;
    for (const ref of ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles) {
      const specifier = ref.fileName;
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (isBuiltin(specifier)) continue;
      seen += 1;
      const owner = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      if (owner === manifest.name || declared.has(owner)) continue;
      findings.push(`${file}: ${specifier}`);
    }
  }
  return { findings, seen };
}

/**
 * The host package, supplied to the fixture's **build** the way a third-party
 * author's install supplies it: a `node_modules` entry, resolved by walking up
 * from the importing file, never a `paths` alias and never a relative path.
 *
 * The fixture is not a `pnpm-workspace.yaml` member, so pnpm links nothing into
 * it — which is the property the whole criterion rests on and is not weakened
 * here: this link is on a **peer's** path, exactly as `provisionHostPeers` does
 * for the two ORM peers in the instance, and A8 measures the path of the
 * package's **own** directory. The link is created under the fixture's own
 * git-ignored `node_modules`, so nothing lands in the working tree.
 */
function provisionFixturePeers(): void {
  const hostDir = join(REPO_ROOT, 'packages', 'platform');
  if (!existsSync(join(hostDir, 'dist'))) {
    refuse(
      `the host package at ${hostDir} is not built — run \`pnpm run build:packages\` first. ` +
        'The fixture imports `@endora-commerce/platform/kernel`, which resolves through that ' +
        "package's own `exports` map at `./dist`",
    );
  }
  const scoped = join(FIXTURE_DIR, 'node_modules', '@endora-commerce');
  mkdirSync(scoped, { recursive: true });
  const link = join(scoped, 'platform');
  if (!existsSync(link)) symlinkSync(hostDir, link, 'dir');
  notes.push(
    'fixture build peer: @endora-commerce/platform linked into the fixture\'s own ' +
      'node_modules, resolved as a bare specifier through its `exports` map',
  );
}

/** Step 1 — build the fixture, and refuse an artefact that gives the game away. */
async function buildFixture(): Promise<string> {
  if (!existsSync(join(FIXTURE_DIR, 'package.json'))) {
    refuse(`the fixture package is not at ${FIXTURE_DIR}`);
  }
  provisionFixturePeers();
  const tsc = binary('tsc');
  rmSync(join(FIXTURE_DIR, 'dist'), { recursive: true, force: true });
  const built = run(tsc, ['-p', join(FIXTURE_DIR, 'tsconfig.json')], { cwd: FIXTURE_DIR });
  if (built.code !== 0) refuse('the fixture package does not build');

  const dist = join(FIXTURE_DIR, 'dist');
  if (!existsSync(dist)) refuse('the fixture build produced no dist/');
  const files = walkFiles(dist);
  if (files.length === 0) refuse('the fixture build produced an empty dist/');
  // `dist/manifest.js`, exactly there, is the proof that `rootDir` held. A
  // single import that resolves into this repository (a type import through
  // `paths` is enough) puts those sources in the program, moves tsc's common
  // root up to the repository, and emits the whole tree — the package's own
  // entry point lands at `dist/backend/acceptance/…/manifest.js`, the `exports`
  // map points at nothing, and a compiler that emitted files into
  // `packages/contracts/src/` has already run. Measured, not imagined: that is
  // what the first build of this fixture did.
  if (!existsSync(join(dist, 'manifest.js'))) {
    refuse(
      `the fixture build emitted no ${join(dist, 'manifest.js')} — its tsconfig rootDir did not ` +
        'hold, which means something in src/ resolves into this repository. Remove that import; ' +
        'a package must not name a file in the tree that hosts it',
    );
  }
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const needle of ARTEFACT_MUST_NOT_CONTAIN) {
      if (source.includes(needle)) {
        refuse(
          `the built artefact ${file} contains "${needle}". The fixture must be invisible to ` +
            'every mechanism that works today; an artefact a source-text probe can read would ' +
            'make a green here mean nothing',
        );
      }
    }
  }
  const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, 'package.json'), 'utf8')) as {
    name?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const { findings, seen } = await undeclaredSpecifiers(files, manifest);
  if (findings.length > 0) {
    refuse(
      `the built artefact reaches ${findings.length} specifier(s) the fixture's manifest does ` +
        `not declare: ${findings.join('; ')}. An installed package reaches what its manifest ` +
        'says the instance must supply, and nothing else',
    );
  }
  notes.push(
    `fixture built: ${files.length} file(s) in dist/, none containing ` +
      `${ARTEFACT_MUST_NOT_CONTAIN.map((n) => `"${n}"`).join(', ')}; ` +
      `${seen} bare specifier(s) read, all declared by the fixture's manifest`,
  );
  return dist;
}

/** Step 2 — `pnpm pack`, into a directory outside the repository. */
function packFixture(destination: string): string {
  const packed = run('pnpm', ['pack', '--pack-destination', destination], { cwd: FIXTURE_DIR });
  if (packed.code !== 0) refuse('`pnpm pack` failed for the fixture package');
  const tarballs = readdirSync(destination).filter((f) => f.endsWith('.tgz'));
  const tarball = tarballs[0];
  if (tarballs.length !== 1 || tarball === undefined) {
    refuse(`expected exactly one tarball in ${destination}, found ${tarballs.length}`);
  }
  notes.push(`packed: ${tarball}`);
  return join(destination, tarball);
}

/**
 * Step 3/4 — a real install into a throwaway instance.
 *
 * The host supplies the MikroORM peers **and the host package itself** by link,
 * which is what a peer dependency *means* and what a real instance does: the
 * platform and the package must share one `@mikro-orm/core` and one
 * `@endora-commerce/platform`. The links are on the peers' paths, never on the
 * package's own — which is exactly the distinction A8 measures, and A9 proves
 * that distinction can still say no.
 *
 * **What a second copy actually does was measured, and it is not what this
 * comment used to say** (feature 080, T042a §0c; D-160.6). It said the package's
 * decorators "write into a `MetadataStorage` the host's ORM never reads", i.e.
 * two copies produce two registries. They do not:
 * `MetadataStorage.metadata = Utils.getGlobalStorage('metadata')`, and
 * `getGlobalStorage` is `globalThis['mikro-orm-' + namespace]` with **no version
 * in the key**, so two copies of `@mikro-orm/core` share **one** registry. What
 * happens instead is worse in the way that matters: the package's entity is
 * registered and then **silently dropped from discovery** — no throw, no
 * warning, exit 0, and a table that never gets created. A split registry would
 * at least have been visible from the package's side. Two copies of the *host*
 * are the loud case, `MetadataError: Duplicate entity names are not allowed`.
 * The remedy below was always right; only its stated mechanism was wrong.
 */
function installInto(instance: string, spec: string): void {
  mkdirSync(instance, { recursive: true });
  writeFileSync(
    join(instance, 'package.json'),
    `${JSON.stringify(
      { name: 'endora-acceptance-instance', version: '0.0.0', private: true, type: 'module' },
      null,
      2,
    )}\n`,
  );
  // `auto-install-peers=false`: a second copy of the ORM in the instance is the
  // duplicate-metadata failure described above, and pnpm would install one.
  writeFileSync(
    join(instance, '.npmrc'),
    'auto-install-peers=false\nstrict-peer-dependencies=false\nignore-workspace=true\n',
  );
  const added = run('pnpm', ['add', spec], { cwd: instance });
  if (added.code !== 0) refuse(`\`pnpm add ${spec}\` failed in ${instance}`);
}

function provisionHostPeers(instance: string): void {
  const scoped = join(instance, 'node_modules', '@mikro-orm');
  mkdirSync(scoped, { recursive: true });
  for (const peer of ['core', 'migrations']) {
    const hostCopy = join(BACKEND_ROOT, 'node_modules', '@mikro-orm', peer);
    if (!existsSync(hostCopy)) refuse(`the host has no @mikro-orm/${peer} to supply as a peer`);
    const link = join(scoped, peer);
    if (!existsSync(link)) symlinkSync(hostCopy, link, 'dir');
  }
  // The third peer, and the one the fixture names in its own sources: the host
  // package. It is supplied here rather than installed, for the reason the ORM
  // peers are — the instance must hold exactly one copy — and it is a *peer*
  // rather than a workspace `link:` on the package's own path, which is the
  // condition T042a §6 attaches to the fixture dropping its structural
  // re-declaration of `ModuleContext`.
  //
  // **Everything the fixture takes from the host is type-only today, and that is
  // load-bearing rather than incidental.** This link resolves to
  // `packages/platform/dist`, while the platform process below runs
  // `backend/src` through `tsx` — the same sources, compiled twice, so they are
  // two copies in exactly the sense §3 means. Types are erased, so nothing
  // crosses. A **value** import would cross, and the first one anybody reaches
  // for is `@GlobalEntity()` from `./tenancy` (219 specifiers in the tree): the
  // package's class would be classified in the `dist` copy's registry and the
  // running platform would read the other one, silently, which is the
  // fail-quiet shape the whole singleton rule exists to refuse. Do not add a
  // value import here until the platform process itself runs the built host.
  const hostPackage = join(REPO_ROOT, 'packages', 'platform');
  if (!existsSync(join(hostPackage, 'dist'))) {
    refuse('the host package is not built — run `pnpm run build:packages` first');
  }
  const hostScope = join(instance, 'node_modules', '@endora-commerce');
  mkdirSync(hostScope, { recursive: true });
  const hostLink = join(hostScope, 'platform');
  if (!existsSync(hostLink)) symlinkSync(hostPackage, hostLink, 'dir');
  notes.push(
    'host-provided peers: @mikro-orm/core, @mikro-orm/migrations and ' +
      '@endora-commerce/platform are linked from the platform, so package and host share ' +
      'one copy (see installInto for what a second one does)',
  );
}

/** Step 5 — a disposable database, dropped and rebuilt on every run. */
async function resetDatabase(dsn: string, adminUrl: string, databaseName: string): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch (error) {
    refuse(
      `PostgreSQL is not reachable at ${adminUrl.replace(/:[^:@/]*@/, ':***@')}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await client.query(`drop database if exists "${databaseName}" with (force)`);
    await client.query(`create database "${databaseName}"`);
  } finally {
    await client.end();
  }
  notes.push(`database: ${databaseName} dropped and re-created (DSN name guard passed)`);
  void dsn;
}

/**
 * The deployment this repository ships for the acceptance criterion's own use,
 * and the one phase that composes as it.
 *
 * `backend/src/apps/acceptance/` holds a single overlay module whose whole
 * content is a decoration over a registration the fixture **package** owns. Its
 * `DEPLOYMENT` is added to one phase's environment rather than to `probeEnv`,
 * because every other phase's answer is about bare core plus a package: composing
 * an overlay module into them would put a second module's registrations,
 * settings rows and lifecycle presence inside assertions that were measured
 * without them.
 */
const OVERLAY_DEPLOYMENT = 'acceptance';
const OVERLAY_DECORATION_PHASE = 'overlay-decoration';

/** `probeEnv`, plus `DEPLOYMENT` for the one phase that is about a deployment. */
function deploymentEnvFor(phase: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return phase === OVERLAY_DECORATION_PHASE
    ? { ...base, DEPLOYMENT: OVERLAY_DEPLOYMENT }
    : base;
}

/** Step 6 — one platform process per phase. */
function runPhase(
  phase: string,
  env: NodeJS.ProcessEnv,
): { results: AssertionResult[] } | { inconclusive: string } {
  const tsx = binary('tsx');
  const probe = join(SCRIPT_DIR, 'instance-probe.ts');
  const result = run(tsx, [probe, phase], { cwd: BACKEND_ROOT, env, quiet: true });
  const line = result.stdout
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('ACCEPTANCE_JSON '));
  if (!line) {
    return {
      inconclusive:
        `the ${phase} probe printed no verdict (exit ${result.code}). ` +
        `stderr: ${result.stderr.slice(-800)}`,
    };
  }
  const payload = JSON.parse(line.slice('ACCEPTANCE_JSON '.length)) as {
    results?: AssertionResult[];
    inconclusive?: string;
    phaseError?: string;
  };
  if (payload.inconclusive) return { inconclusive: `${phase}: ${payload.inconclusive}` };
  if (payload.phaseError) {
    // A phase that threw where it was supposed to answer has measured nothing,
    // so it is neither colour. Reporting it as red would be a criterion that
    // fails when the harness does.
    return { inconclusive: `${phase} threw: ${payload.phaseError.slice(0, 800)}` };
  }
  return { results: payload.results ?? [] };
}

async function main(): Promise<void> {
  const keepTemp = process.env['ACCEPTANCE_KEEP_TMP'] === '1';
  const ratchet = process.argv.includes('--against-expectation');
  if (ratchet && !existsSync(EXPECTATION_FILE)) {
    refuse(`--against-expectation was asked for and ${EXPECTATION_FILE} does not exist`);
  }
  const dsn = process.env['ACCEPTANCE_DATABASE_URL'] ?? DEFAULT_DSN;
  const target = resolveDatabaseTarget(dsn);
  if ('error' in target) refuse(target.error);

  const temp = mkdtempSync(join(tmpdir(), 'endora-pkg-acceptance-'));
  const instance = join(temp, 'instance');
  const movedInstance = join(temp, 'moved-instance');
  const tarballDir = join(temp, 'artefact');
  mkdirSync(tarballDir, { recursive: true });
  if (!instanceIsOutsideRepository(temp, REPO_ROOT)) {
    refuse(
      `the temporary directory ${temp} is inside the repository working tree, so an install ` +
        'there proves nothing about leaving it (check TMPDIR)',
    );
  }

  const results: AssertionResult[] = [];
  try {
    await buildFixture();
    const tarball = packFixture(tarballDir);

    installInto(instance, tarball);
    provisionHostPeers(instance);
    const installedManifest = join(
      instance,
      'node_modules',
      ...PACKAGE_NAME.split('/'),
      'package.json',
    );
    if (!existsSync(installedManifest)) {
      refuse(`the tarball install left no ${installedManifest}`);
    }
    results.push(
      evaluateA8(
        classifyResolutionPath({
          resolved: installedManifest,
          instanceRoot: instance,
          repositoryRoot: REPO_ROOT,
        }),
      ),
    );

    // A9 — the same package, consumed the way F4's own wording invites: a
    // directory inside the repository, linked rather than installed. pnpm does
    // the linking, so the shape is the one a workspace member really has.
    //
    // The linked directory is the fixture's own source tree rather than a real
    // `packages/modules/<id>`: A8's predicate is *repository containment*, the
    // two paths are indistinguishable to it, and materialising a package under
    // `packages/` at runtime would make the fixture a pnpm workspace member for
    // every concurrent command in this checkout — mutating the tree the
    // criterion is measuring. `ACCEPTANCE_MOVED_DIR` overrides it for anyone
    // who wants the literal path.
    const movedDir = process.env['ACCEPTANCE_MOVED_DIR'] ?? FIXTURE_DIR;
    installInto(movedInstance, `link:${movedDir}`);
    const movedManifest = join(
      movedInstance,
      'node_modules',
      ...PACKAGE_NAME.split('/'),
      'package.json',
    );
    const movedUsable =
      existsSync(movedManifest) && existsSync(join(dirname(movedManifest), 'dist', 'manifest.js'));
    results.push(
      evaluateA9(
        classifyResolutionPath({
          resolved: movedManifest,
          instanceRoot: movedInstance,
          repositoryRoot: REPO_ROOT,
        }),
        movedUsable,
      ),
    );
    notes.push(`A9 consumed the package by link from ${movedDir}`);

    await resetDatabase(target.databaseUrl, target.adminUrl, target.databaseName);

    const probeEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: target.databaseUrl,
      ACCEPTANCE_INSTANCE_ROOT: instance,
      // The platform's own name for the same directory (feature 080, T031).
      //
      // In a real deployment the platform *is* the instance — its
      // `node_modules` is where an operator's packages are installed — so
      // nothing sets this and package discovery reads the chain above the
      // running code. Here the two are deliberately not the same: the probe
      // boots this repository's backend against a package installed somewhere
      // else, which is the whole procedure. So the harness has to say where
      // "somewhere else" is, exactly as it already does for its own
      // `createRequire` (`ACCEPTANCE_INSTANCE_ROOT`, two lines up).
      //
      // It is plumbing, not the mechanism, and the difference is testable:
      // setting this variable against a platform that cannot discover a package
      // changes no assertion. It is what made A5 red before T031 and it is not
      // what makes it green.
      ENDORA_INSTANCE_ROOT: instance,
      ACCEPTANCE_PACKAGE_NAME: PACKAGE_NAME,
      NODE_ENV: 'test',
      SESSION_COOKIE_SECRET: 'acceptance-secret',
      PUBLIC_API_BASE_URL: process.env['PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      BACKEND_RUN_WORKERS: 'false',
    };

    const inconclusive: string[] = [];
    // The operator's own sequence, one process each. `boot` and `install` are
    // not scaffolding for the two gate phases: they are the steps a real
    // instance has between `pnpm add` and an operator flipping a control.
    // `install` is a package's only author — of its `module_registrations` row
    // since D-157.6(b), and of its settings rows through step 2 of the same
    // operation — and the probe reached it through no phase at all, which is
    // what left A6 and A7 red with the platform half of each already working.
    //
    // `overlay-decoration` (A10) sits between the install and the gates, where
    // the package is fully present: installed by the phase above it, and not yet
    // touched by the activation flips below it. It is the one phase that
    // composes as a **deployment**, and the `DEPLOYMENT` variable is added for
    // it alone (see `deploymentEnvFor`) — every other phase composes bare core,
    // so the nine assertions around it measure what they measured before A10
    // existed.
    for (const phase of [
      'schema',
      'boot',
      'install',
      'overlay-decoration',
      'gate-off',
      'gate-on',
      'uninstall',
    ] as const) {
      const outcome = runPhase(phase, deploymentEnvFor(phase, probeEnv));
      if ('inconclusive' in outcome) inconclusive.push(outcome.inconclusive);
      else results.push(...outcome.results);
    }
    for (const reason of inconclusive) notes.push(`inconclusive: ${reason}`);

    const merged = mergeResults(results, inconclusive);
    console.log(formatReport(merged, notes));
    const criterion = exitCodeFor(merged);
    console.log(
      criterion === 0
        ? '[acceptance] the criterion is MET: a package installed from a tarball reaches the database.'
        : criterion === 1
          ? '[acceptance] the criterion is NOT met. Each FAIL above names what is missing.'
          : '[acceptance] the criterion could not be measured in full — see INCONCLUSIVE above.',
    );

    if (!ratchet) process.exit(criterion);

    // Ratchet mode (CI). What is enforced is drift against the committed
    // expectation, in both directions — never the colour itself. That was
    // written when the criterion was red on purpose, and it is what keeps
    // working now that all nine pass: a regression is drift too.
    const expectation = JSON.parse(readFileSync(EXPECTATION_FILE, 'utf8')) as {
      assertions: AcceptanceExpectation;
    };
    const comparison = compareToExpectation(merged, expectation.assertions);
    for (const error of comparison.ledgerErrors) console.error(`[acceptance] ledger: ${error}`);
    for (const missing of comparison.unmeasured) {
      console.error(`[acceptance] unmeasured: ${missing.id} — ${missing.detail}`);
    }
    for (const drifted of comparison.drift) {
      console.error(
        `[acceptance] drift: ${drifted.id} was expected to ${drifted.expected} and ` +
          `answered ${drifted.actual}. ${drifted.detail}`,
      );
    }
    const code = exitCodeForExpectation(comparison);
    console.log(
      code === 0
        ? `[acceptance] no drift against ${EXPECTATION_FILE}: the criterion answered exactly ` +
            'what this repository says it answers today.'
        : code === 1
          ? '[acceptance] the criterion moved. If it moved forward, record the new answer in ' +
            `${EXPECTATION_FILE} in the merge request that earned it — never to make a ` +
            'pipeline pass.'
          : '[acceptance] the run measured less than the expectation covers; nothing is claimed.',
    );
    process.exit(code);
  } finally {
    if (keepTemp) console.log(`[acceptance] kept ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

// Run as CLI only — importing this module (e.g. from a unit test, which is what
// typechecks it) must not start a build, an install or a database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
