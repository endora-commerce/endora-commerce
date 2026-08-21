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
 * It is **red on purpose**, and the failures name what is missing: nothing in
 * this repository discovers an installed package, so its migration is in no
 * registry, its entity is in no ORM metadata, and its manifest is in no
 * resolved set. A8 and A9 pass today, which is the point of them — they are the
 * two assertions that measure the *harness* rather than the platform, and if
 * they could not pass now they would never be trusted later.
 *
 * Contract: `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.
 * Usage: `pnpm --filter backend run acceptance:package-schema`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** Strings that must not survive into the published artefact. */
const ARTEFACT_MUST_NOT_CONTAIN = ['@Entity(', '@b2b/', 'backend/src'] as const;

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

/** Step 1 — build the fixture, and refuse an artefact that gives the game away. */
function buildFixture(): string {
  if (!existsSync(join(FIXTURE_DIR, 'package.json'))) {
    refuse(`the fixture package is not at ${FIXTURE_DIR}`);
  }
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
  notes.push(
    `fixture built: ${files.length} file(s) in dist/, none containing ` +
      ARTEFACT_MUST_NOT_CONTAIN.map((n) => `"${n}"`).join(', '),
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
 * The host supplies the two MikroORM peers by link, which is what a peer
 * dependency *means* and what a real instance does: the platform and the
 * package must share one `@mikro-orm/core`, or the package's decorators write
 * into a `MetadataStorage` the host's ORM never reads and A4 goes red for a
 * reason that has nothing to do with packaging. The links are on the peers'
 * paths, never on the package's own — which is exactly the distinction A8
 * measures, and A9 proves that distinction can still say no.
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
  notes.push(
    'host-provided peers: @mikro-orm/core and @mikro-orm/migrations are linked from the ' +
      'platform, so package and host share one copy (see installInto for why)',
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
    buildFixture();
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
      ACCEPTANCE_PACKAGE_NAME: PACKAGE_NAME,
      NODE_ENV: 'test',
      SESSION_COOKIE_SECRET: 'acceptance-secret',
      PUBLIC_API_BASE_URL: process.env['PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      BACKEND_RUN_WORKERS: 'false',
    };

    const inconclusive: string[] = [];
    for (const phase of ['schema', 'gate-off', 'gate-on', 'uninstall'] as const) {
      const outcome = runPhase(phase, probeEnv);
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

    // Ratchet mode (CI). The criterion is red today and is meant to be, so a
    // job that failed on the red would block every merge request touching a
    // migration registry. What is enforced instead is drift against the
    // committed expectation, in both directions.
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
