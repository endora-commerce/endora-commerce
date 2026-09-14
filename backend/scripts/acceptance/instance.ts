/**
 * The acceptance criterion for `endora new instance`
 * (`specs/110-instance-repository/` FR-011, T140).
 *
 * ## What it does, and why it is not a test in `backend/test/`
 *
 * It scaffolds an **instance** outside this checkout, installs it with no
 * symlink back, migrates a throwaway PostgreSQL and boots the result.
 * `contracts/instance-repository.md` R6.1 says why it is a script rather than a
 * vitest file in as many words: *"its subject is a tree outside this checkout,
 * which no vitest file composing the platform from the repository it lives in
 * can honestly be"*. It is not a `check-*` script either and must not become
 * one — `test/unit/scripts/check-read-size.test.ts` spawns every one of those,
 * and an install plus a migration plus a boot inside a unit run is not a test.
 * `acceptance:package-schema`, `acceptance:storefront-scaffold`, `boot-gate`
 * and `pack-gate` are the four precedents and each says the same thing.
 *
 * ## R6.2a is an assertion about the run, not a setting
 *
 * D-208 rules that the product is an installed binary. So this criterion packs
 * `@endora-commerce/cli`, installs it into a **host** directory under
 * `os.tmpdir()` with no `pnpm-workspace.yaml` and no git repository above it,
 * and invokes `node_modules/.bin/endora` — never `pnpm --filter`, never `tsx`,
 * never this checkout's sources. `pack-gate`'s own reasoning applies one
 * criterion over: run from a bare extraction, `endora --help` once printed a
 * 1115-byte stack trace and **passed** a rule that only asked for output, so a
 * proof that a crash passes is not a proof. The three conditions are checked
 * before the command runs and each is exit 2, because a run that invoked the
 * CLI some other way has measured something D-208 does not rule about.
 *
 * ## Two supply routes, and the tarball one is the default
 *
 * `acceptance:storefront-scaffold`'s arrangement unchanged. **`tarball`** packs
 * every publishable package out of this checkout and pins it; it is the only
 * mode that works before the first publish and it is what keeps the criterion
 * runnable on a branch that publishes nothing. **`registry`** installs the
 * ranges the scaffold wrote, from a real registry, through the `.npmrc`
 * `endora new instance --registry` emits. The mode is chosen by
 * `ENDORA_NPM_REGISTRY` and never by a flag, so the job that has the variables
 * takes the second route and every other run takes the first.
 *
 * ## The tarball mode pins the **closure**, and the extras are a finding
 *
 * The manifest the command writes names the module set and the platform. A
 * `pnpm install` resolves more: a module package peers on its siblings and
 * `auto-install-peers` is on by default, so a non-optional peer is fetched
 * whether or not the instance declared it — and measured on pnpm 10.28,
 * `overrides` are **not** applied to an auto-installed peer, so pinning only
 * what the manifest names sends those fetches to npmjs for packages nobody has
 * published. The closure is therefore derived from the installed manifests
 * ({@link endoraClosure}), never listed here, and the packages it adds beyond
 * the declared set are disclosed in a note: a module package arriving as a peer
 * is composed by the platform's runtime discovery exactly as a declared one is.
 *
 * ## It runs the instance's own scripts, and that is deliberate
 *
 * `instance-tree.md` §2.5 is the contract for what `migrate`, `build` and
 * `start` are, and `nextSteps()` is what a client is told to run. A criterion
 * that reached past them into the member's own scripts would be measuring a
 * sequence nobody is told about and would report green over a root manifest
 * whose scripts do not work.
 *
 * ## The database is this run's own, created and dropped by it
 *
 * The DSN's database name must satisfy the disposable-name convention
 * `(^|_)test(_|$)` — the judgement `test/global-setup.ts` and the dev-seed
 * guard both make, shared here through `assertions.ts`' `resolveDatabaseTarget`
 * rather than written a second time. It is what keeps a mistyped DSN from being
 * a data-loss incident: `db:fresh`, `db:reset` and every `module:*` CLI default
 * to the **dev** database, and one bare `module:disable` once disabled 43 of 67
 * modules in a developer's.
 *
 * ## Exit codes
 *
 * R6.4: **0** met, **1** measured and red, **2** could not be measured. Never a
 * green for a step that did not run. With `--against-expectation` the run is
 * compared to `backend/acceptance/instance-expected-state.json` and drift fails
 * in **either** direction.
 *
 * Usage: `pnpm --filter backend run acceptance:instance`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import { normalizeRegistry, parseEnvFile, writeEnvFile } from '@endora-commerce/cli';
import { instanceComposition } from '@endora-commerce/cli/lib/divergence-artefacts.js';
import {
  discoverModulePackages,
  scanInstalledPlatformPackage,
} from '@endora-commerce/cli/lib/module-packages.js';

import { resolveDatabaseTarget } from './assertions.js';
import {
  compareToExpectation,
  completeResults,
  describeRegistrySupply,
  endoraClosure,
  evaluateA1,
  evaluateA3,
  evaluateA4,
  evaluateA10,
  evaluateA11,
  evaluateA13,
  evaluateA5,
  evaluateA6,
  evaluateA7,
  evaluateA8,
  evaluateA9,
  type AdminStylesheetObservation,
  type DivergenceReportEntry,
  type OverlayModuleObservation,
  type TenancyGuardObservation,
  type DocsSiteObservation,
  evaluateA14,
  evaluateA15,
  ADMIN_LOGIN_PATH,
  type AdministratorObservation,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  failureExcerpt,
  expectationRefusals,
  formatReport,
  hostNpmrc,
  reconcileFigures,
  type AcceptanceExpectation,
  type AcceptanceMode,
  type AppliedMigrations,
  type AssertionResult,
  type DigestedFile,
  type PackageDependencyDeclaration,
  type ShippedFiles,
  type SuppliedPackage,
} from './instance-assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const EXPECTATION_FILE = join(BACKEND_ROOT, 'acceptance', 'instance-expected-state.json');
const DEFAULT_DSN = 'postgresql://b2b:b2b@localhost:5432/b2b_instance_acceptance_test';
const HEALTH_PATH = '/api/v1/_health';
const PRESENCE_PATH = '/api/v1/storefront/module-presence';
const OPENAPI_PATH = '/api/v1/_openapi.json';
const SCOPE = '@endora-commerce';

/**
 * A8's fixture: the overlay module this criterion writes into the tree the
 * command created, and the one container name it wraps.
 *
 * **Why this name and not another**, which is worth knowing before changing it.
 * An overlay module may not wrap a registration an installed package owns
 * (D-176 Q3), and in an instance every module is an installed package —
 * measured: wrapping `price_lists`' `pricingService` dies at composition with
 * `PackageDecorationNotOfferedError`.
 *
 * A name the composition root supplies is exempt from that rule (D-156.4 names
 * `commandBus` in so many words) and **used to die differently**: every
 * root-supplied name is registered `asValue`, awilix marks such a resolver
 * `isLeakSafe` and gives it no lifetime, and `ctx.di.decorate` re-registered the
 * wrapper as `asFunction(...).setLifetime(inner.lifetime ?? Lifetime.TRANSIENT)`
 * — leaking the safety and the lifetime both, so the first singleton to resolve
 * the name raised `AwilixResolutionError: … has a shorter lifetime than its
 * ancestor` (measured on `commandBus` behind `catalog`, and on
 * `storefrontBaseUrl` behind `organizations`). **That is repaired**
 * (`specs/124-instance-customisation-gap/` FR-003): the wrapper over a
 * leak-safe, lifetime-less resolver is registered `.singleton()`, so a
 * root-supplied name is a target this criterion could take.
 *
 * It has not been moved to one, deliberately. The module's own registration is
 * the name whose *attribution* A8's second half is about, and a fixture that
 * changes what it decorates in the same merge request that repairs the report
 * would leave neither half comparable with what was measured before.
 */
const OVERLAY_MODULE_ID = 'instance_acceptance_overlay';
const OVERLAY_REGISTRATION = 'instanceAcceptanceOverlayService';
const OVERLAY_MARKER = 'decorated-by-the-instance-acceptance-overlay';
const OVERLAY_PROBE_PATH = '/api/v1/storefront/instance-acceptance-overlay/ping';
const OVERLAY_REASON =
  'The acceptance criterion writes this overlay module, so R6.3 A8 has an overlay module to ' +
  'compose and a decoration to look for in the rendered report.';

const notes: string[] = [];

function refuse(message: string): never {
  console.error(`[instance-acceptance] cannot measure: ${message}`);
  console.error('[instance-acceptance] exit 2 — neither a pass nor a failure of the criterion.');
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
 * Which supply route this run measures, decided by the environment alone.
 *
 * A registry with no token is a **refusal**, not a fall back to the tarball
 * mode and not an anonymous attempt: a GitLab npm endpoint answers a missing
 * credential with 404 and pnpm reports it in the same sentence it gives for a
 * package that was never published, so the red would be indistinguishable from
 * the criterion's own subject failing.
 *
 * An endpoint no `.npmrc` line can be keyed on is the same kind of answer and
 * is decided **here**, before anything is packed or written: the alternative is
 * a throw out of the middle of `provisionHost` with a stack trace and exit 1,
 * which reports a configuration this run could not use as a failure of the
 * criterion. The value comes back normalised, so the host's file and the
 * `--registry` the command is given name one endpoint and not two spellings
 * of it.
 */
function resolveMode(): { mode: AcceptanceMode; registry: string | null } {
  const registry = (process.env['ENDORA_NPM_REGISTRY'] ?? '').trim();
  if (registry.length === 0) return { mode: 'tarball', registry: null };
  if ((process.env['ENDORA_NPM_TOKEN'] ?? '').trim().length === 0) {
    refuse(
      `ENDORA_NPM_REGISTRY names ${registry} and ENDORA_NPM_TOKEN is unset. The registry ` +
        `answers an absent credential with 404 and pnpm reports it as "is not in the npm ` +
        `registry", which is byte-identical to the packages never having been published — so ` +
        `this run would produce a red A2 that says nothing about the criterion.`,
    );
  }
  try {
    return { mode: 'registry', registry: normalizeRegistry(registry) };
  } catch (error: unknown) {
    refuse(
      `ENDORA_NPM_REGISTRY is not an endpoint an \`.npmrc\` can be written against: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Every publishable workspace package of this checkout, with its directory. */
function publishablePackages(): readonly { name: string; dir: string }[] {
  const found: { name: string; dir: string }[] = [];
  const roots = [join(REPO_ROOT, 'packages')];
  const walk = (root: string): void => {
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) {
        walk(dir);
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string;
        private?: boolean;
      };
      if (manifest.private === true || typeof manifest.name !== 'string') continue;
      found.push({ name: manifest.name, dir });
    }
  };
  for (const root of roots) walk(root);
  if (found.length === 0) {
    refuse(
      `no publishable package was found under ${join(REPO_ROOT, 'packages')}. With nothing to ` +
        `pack there is nothing for an instance to install, and every assertion below the ` +
        `install would be answering about an empty tree.`,
    );
  }
  return found;
}

/** Pack every publishable package once, into one directory. */
function packEverything(tarballDir: string): ReadonlyMap<string, string> {
  const packed = new Map<string, string>();
  for (const pkg of publishablePackages()) {
    if (!existsSync(join(pkg.dir, 'dist'))) {
      refuse(`${pkg.dir} has no dist — run \`pnpm run build:packages\` first`);
    }
    const before = new Set(readdirSync(tarballDir));
    const result = run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: pkg.dir });
    if (result.code !== 0) refuse(`\`pnpm pack\` failed for ${pkg.name}:\n${result.output}`);
    const written = readdirSync(tarballDir).filter(
      (entry) => entry.endsWith('.tgz') && !before.has(entry),
    );
    if (written.length !== 1) {
      refuse(`\`pnpm pack\` in ${pkg.dir} wrote ${String(written.length)} tarballs, expected one`);
    }
    packed.set(pkg.name, join(tarballDir, written[0]!));
  }
  notes.push(`packed ${String(packed.size)} publishable packages out of this checkout`);
  return packed;
}

/**
 * The directory the CLI is installed into, and invoked from.
 *
 * R6.2a's *"a directory with no workspace and no git above it"*. It is a
 * **sibling** of the instance rather than its parent, deliberately: a
 * `node_modules` above the created tree would let the instance's own install
 * resolve a package it never declared, which is the one way this criterion
 * could report a green install over a manifest that is short.
 */
function provisionHost(
  hostDir: string,
  packed: ReadonlyMap<string, string> | null,
  registry: string | null,
): void {
  mkdirSync(hostDir, { recursive: true });
  const dependencies: Record<string, string> = {};
  if (packed === null) {
    for (const pkg of publishablePackages()) dependencies[pkg.name] = 'latest';
  } else {
    for (const [name, tarball] of packed) dependencies[name] = `file:${tarball}`;
  }
  writeFileSync(
    join(hostDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'endora-instance-acceptance-host',
        private: true,
        version: '0.0.0',
        dependencies,
        // The host is not a workspace, so pnpm reads its overrides from here —
        // which is the difference from the instance's, where the same block has
        // to go into `pnpm-workspace.yaml`. They are needed for the same reason
        // in both places: `pnpm pack` rewrites a packed manifest's `workspace:`
        // range to a version no registry serves, so the CLI's own dependency on
        // `@endora-commerce/contracts` is as unpublished as everything else.
        ...(packed === null ? {} : { pnpm: { overrides: dependencies } }),
      },
      null,
      2,
    )}\n`,
  );
  // The host is not an instance and its `.npmrc` is the harness's own: the
  // instance's is written by the command, and asserting that is A2's job. How a
  // credential is **keyed** is the one thing the two may not decide separately,
  // so that half comes from the command's own derivation — see `hostNpmrc`.
  writeFileSync(join(hostDir, '.npmrc'), hostNpmrc(registry, SCOPE));
  const installed = run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: hostDir });
  if (installed.code !== 0) {
    refuse(
      `the host directory's own install failed, so there is no installed \`endora\` binary to ` +
        `measure:\n${installed.output}`,
    );
  }
}

/**
 * Every package an unconsumed changeset names — this checkout's own statement
 * that a package holds work no publish carries.
 *
 * It is read rather than inferred because the case it exists for is invisible
 * to every other instrument: a registry serving `0.8.0` and a checkout
 * declaring `0.8.0` are indistinguishable by version, and were two different
 * programs on 2026-09-14. `check:release-intent` judges a release by this same
 * source, so the two answer from one place.
 */
function packagesWithUnconsumedChangesets(): ReadonlySet<string> {
  const named = new Set<string>();
  const dir = join(REPO_ROOT, '.changeset');
  if (!existsSync(dir)) return named;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md') || entry === 'README.md') continue;
    const text = readFileSync(join(dir, entry), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (front === null) continue;
    for (const line of front[1]!.split('\n')) {
      const match = /^\s*['"]?(@[^'"\s:]+\/[^'"\s:]+)['"]?\s*:/.exec(line);
      if (match !== null) named.add(match[1]!);
    }
  }
  return named;
}

/**
 * What the registry served, package by package — the input to the note the
 * `registry` mode's report opens with.
 *
 * The served version is read off the **installed** manifest rather than asked
 * of the registry a second time: that is the tarball this run will actually
 * measure, and a second query is a second answer to one question (D-100).
 */
function suppliedPackages(hostDir: string): readonly SuppliedPackage[] {
  const pending = packagesWithUnconsumedChangesets();
  const supplied: SuppliedPackage[] = [];
  for (const pkg of publishablePackages()) {
    const installed = join(hostDir, 'node_modules', ...pkg.name.split('/'), 'package.json');
    if (!existsSync(installed)) continue;
    const served = (JSON.parse(readFileSync(installed, 'utf8')) as { version?: string }).version;
    const declared = (
      JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8')) as { version?: string }
    ).version;
    if (typeof served !== 'string' || typeof declared !== 'string') continue;
    supplied.push({ name: pkg.name, served, declared, pending: pending.has(pkg.name) });
  }
  return supplied;
}

/**
 * R6.2a's three conditions, decided before the command runs.
 *
 * Each is exit 2 rather than a red: a run that invoked the CLI from a checkout,
 * or from inside a workspace, has measured something D-208 does not rule about,
 * and reporting that as the criterion's colour would be the green that means
 * "not looking".
 */
function assertInstalledBinaryContext(hostDir: string, temp: string): string {
  const binary = join(hostDir, 'node_modules', '.bin', 'endora');
  if (!existsSync(binary)) {
    refuse(
      `${binary} is not there after the host install, so this run has no installed binary to ` +
        `invoke and could only have reached this checkout's sources — which is exactly what ` +
        `R6.2a refuses.`,
    );
  }
  for (let current = realpathSync(temp); ; current = dirname(current)) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      refuse(
        `${join(current, 'pnpm-workspace.yaml')} is above ${temp}, so the scaffold would be ` +
          `adopted by a workspace and R6.2a's "no workspace above it" is false for this run.`,
      );
    }
    if (existsSync(join(current, '.git'))) {
      refuse(
        `${join(current, '.git')} is above ${temp}, so R6.2a's "no git repository above it" is ` +
          `false for this run. Set TMPDIR to a directory outside every checkout.`,
      );
    }
    const parent = dirname(current);
    if (parent === current) break;
  }
  notes.push(
    `invoked ${binary} — an installed binary, from a directory with no pnpm-workspace.yaml and ` +
      `no git repository above it (R6.2a)`,
  );
  return binary;
}

/** Every file under a directory, as a repo-relative path, skipping the noise. */
function listFiles(root: string, skip: ReadonlySet<string>): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else found.push(path);
    }
  };
  walk(root, '');
  return found;
}

/**
 * Every file a directory holds, digested — A11's population.
 *
 * Zero-byte files are dropped here rather than in the judgement so that the
 * exclusion is visible at the point it is made: every empty file has the same
 * digest as every other, and the created tree writes an empty `.gitkeep`.
 */
function digestTree(root: string, skip: ReadonlySet<string>): readonly DigestedFile[] {
  const digested: DigestedFile[] = [];
  for (const path of listFiles(root, skip)) {
    const absolute = join(root, path);
    if (statSync(absolute).size === 0) continue;
    digested.push({
      path,
      digest: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
    });
  }
  return digested;
}

/**
 * The `@endora-commerce/*` packages the created **workspace** names — the root
 * manifest and every member's.
 *
 * It read the root's alone until T138, which was complete while the workspace
 * had one member that declares no dependency of its own (§2.3). The admin
 * member declares three — the shell it mounts, the design system its stylesheet
 * imports, and the CLI that renders its two build artefacts — and none of them
 * is in the platform's dependency closure, so a root-only read leaves them
 * resolving `^<version>` against a registry. In tarball mode that is an install
 * failure attributed to A2; and the module set is still the root's (R3.6), so
 * this widens which *packages* are pinned and not which *modules* are composed.
 *
 * The members come off the created `pnpm-workspace.yaml`, which is the tree's
 * own statement of what it is, rather than off a directory list here.
 */
function declaredPackages(target: string): readonly string[] {
  const roots = [target, ...workspaceMemberDirectories(target)];
  const declared: string[] = [];
  for (const root of roots) {
    const manifestPath = join(root, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const name of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]) {
      if (name.startsWith(`${SCOPE}/`) && !declared.includes(name)) declared.push(name);
    }
  }
  if (declared.length === 0) {
    refuse(
      `the created instance declares no ${SCOPE}/* package, so there is nothing to install and ` +
        `every assertion below the install would be answering about an empty set`,
    );
  }
  return declared;
}

/**
 * The member directories the created `pnpm-workspace.yaml` declares.
 *
 * A flat `- name` list, which is what the command writes (§2.1) — a glob would
 * be a shape this criterion does not read, and it says so by returning nothing
 * rather than by guessing, which shows up as a member's packages missing from
 * the pin rather than as a silent pass.
 */
function workspaceMemberDirectories(target: string): readonly string[] {
  const file = join(target, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return [];
  const members: string[] = [];
  let inPackages = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const entry = /^\s+-\s+(\S+)\s*$/.exec(line);
      if (entry === null) break;
      members.push(join(target, entry[1]!.replace(/^['"]|['"]$/g, '')));
    }
  }
  return members;
}

/** What each installed host package declares, for the closure derivation. */
function dependencyDeclarations(
  hostDir: string,
): ReadonlyMap<string, PackageDependencyDeclaration> {
  const root = join(hostDir, 'node_modules', SCOPE);
  const declarations = new Map<string, PackageDependencyDeclaration>();
  if (!existsSync(root)) return declarations;
  for (const entry of readdirSync(root)) {
    const manifestPath = join(root, entry, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    if (typeof manifest.name !== 'string') continue;
    const meta = manifest.peerDependenciesMeta ?? {};
    declarations.set(manifest.name, {
      dependencies: Object.keys(manifest.dependencies ?? {}),
      requiredPeers: Object.keys(manifest.peerDependencies ?? {}).filter(
        (peer) => meta[peer]?.optional !== true,
      ),
    });
  }
  return declarations;
}

/**
 * Publication's stand-in: pin every package in the instance's own closure.
 *
 * Two halves and they are not the same thing. The **overrides** replace the
 * semver ranges the scaffold wrote, and they go into `pnpm-workspace.yaml`
 * rather than into `package.json` because pnpm 10 reads a workspace root's
 * overrides from there — measured: with them in `pnpm.overrides` the install
 * went to npmjs for the first package it wanted. The **extras** are added as
 * dependencies, because an override does not reach an auto-installed peer, so a
 * peer nobody declared is fetched from a registry that has never heard of it.
 */
function pinClosure(
  target: string,
  packed: ReadonlyMap<string, string>,
  closure: { all: readonly string[]; extras: readonly string[] },
): void {
  const lines: string[] = [];
  for (const name of closure.all) {
    const tarball = packed.get(name);
    if (tarball === undefined) {
      refuse(
        `${name} is in the instance's own dependency closure and is not a publishable package ` +
          `of this checkout, so the tarball mode has nothing to pin it to`,
      );
    }
    lines.push(`  "${name}": "file:${tarball}"`);
  }
  appendFileSync(join(target, 'pnpm-workspace.yaml'), `\noverrides:\n${lines.join('\n')}\n`);

  const manifestPath = join(target, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };
  // **Both spellings, and the duplication is deliberate.** pnpm 10 reads a
  // workspace root's overrides from `pnpm-workspace.yaml`; pnpm 9 reads them
  // from `package.json`'s `pnpm.overrides` and ignores the other file. Which of
  // the two runs this is not the criterion's to decide — the repository pins
  // `pnpm@9.15.0` through corepack and a developer's shell may be on 10, and
  // measured, that difference alone was the whole of a red A2: every transitive
  // `@endora-commerce/*` range went to npmjs for a package nobody published.
  // A stand-in that works under one package manager and silently does not under
  // the other is a criterion whose colour is a fact about the machine.
  manifest.pnpm = {
    ...manifest.pnpm,
    overrides: Object.fromEntries(closure.all.map((name) => [name, `file:${packed.get(name)!}`])),
  };
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const block = manifest[field];
    if (block === undefined) continue;
    for (const name of Object.keys(block)) {
      const tarball = packed.get(name);
      if (tarball !== undefined) block[name] = `file:${tarball}`;
    }
  }
  manifest.dependencies ??= {};
  for (const name of closure.extras) manifest.dependencies[name] = `file:${packed.get(name)!}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (closure.extras.length > 0) {
    notes.push(
      `the instance's install pulls in ${String(closure.extras.length)} ${SCOPE} packages its ` +
        `own manifest does not name, as non-optional peers of packages it does: ` +
        `${closure.extras.join(', ')}. They are pinned as dependencies because pnpm does not ` +
        `apply an override to an auto-installed peer — and a module package arriving this way ` +
        `is composed by the platform's runtime discovery exactly as a declared one is, so the ` +
        `set this instance runs is wider than the set it declares.`,
    );
  }
  notes.push(
    `pinned ${String(closure.all.length)} packed tarballs — each range the scaffold wrote ` +
      `replaced in place, and the workspace's own overrides block for the transitive edges. ` +
      `Publication removes both and changes nothing else`,
  );
}

/** The registry mode's precondition, checked before the install rather than inferred from it. */
function assertRegistryNpmrc(target: string, declared: readonly string[]): void {
  const path = join(target, '.npmrc');
  if (!existsSync(path)) {
    refuse(
      `\`endora new instance --registry\` wrote no ${path}. Without it every fetch goes to the ` +
        `default registry, so this run would report on npmjs while claiming to measure the ` +
        `configured one.`,
    );
  }
  const text = readFileSync(path, 'utf8');
  const scopes = [...new Set(declared.map((name) => name.slice(0, name.indexOf('/'))))].sort();
  const unconfigured = scopes.filter((scope) => !text.includes(`${scope}:registry=`));
  if (unconfigured.length > 0) {
    refuse(
      `${path} names no registry for ${unconfigured.join(', ')}; those fetches would go to the ` +
        `default registry.`,
    );
  }
  notes.push(`installing from the registry the scaffold configured for ${scopes.join(', ')}`);
}

/**
 * The environment a process of the **instance's** gets.
 *
 * The instance's own `.env.example` names what its build reads; this harness's
 * environment is not a client's, so every one of those names is withheld unless
 * this run deliberately supplies it. It is `storefront-scaffold.ts`' rule with
 * one difference: an instance also needs values no `.env.example` of its own
 * declares — `DATABASE_URL` among them — and those are supplied explicitly and
 * disclosed, because that gap is itself a finding rather than something to
 * paper over.
 */
function insideInstance(
  declared: readonly string[],
  supplied: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const overlay: NodeJS.ProcessEnv = {};
  for (const name of declared) if (!(name in supplied)) overlay[name] = undefined;
  return { ...overlay, ...supplied };
}

/**
 * A client filling in the `.env` the command wrote, and nothing more.
 *
 * `writeEnvFile` is the CLI's own merge, imported rather than reimplemented:
 * the lines the command already put there — the four generated secrets among
 * them — survive in place, and only the names handed in are written over. A
 * second merge here would be a second set of rules about quoting and blanks,
 * and the file being edited is the one this criterion is trying to prove works.
 *
 * It also **asserts what it did not clobber**, because the interesting claim is
 * negative: a scaffolded instance starts with a session key nobody supplied, and
 * a run that quietly overwrote it would report `A4 PASS` about a value this
 * criterion invented.
 */
function fillInInstanceEnv(target: string, values: Readonly<Record<string, string>>): void {
  const path = join(target, '.env');
  if (!existsSync(path)) {
    refuse(
      `\`endora new instance\` wrote no ${path}. It is where the secrets the command ` +
        `generates go (\`cli-product.md\` R2.5d) and it is the file a client fills in, so ` +
        `without it there is nothing for this run to configure and nothing for the instance ` +
        `to read.`,
    );
  }
  const before = parseEnvFile(readFileSync(path, 'utf8'));
  const generated = [...before.keys()].filter((name) => !(name in values));
  writeFileSync(path, writeEnvFile(readFileSync(path, 'utf8'), new Map(Object.entries(values))));
  const after = parseEnvFile(readFileSync(path, 'utf8'));
  for (const name of generated) {
    if (after.get(name) !== before.get(name)) {
      refuse(`filling in ${path} changed ${name}, which this run did not supply`);
    }
  }
  notes.push(
    `filled in the instance's own \`.env\` with ${Object.keys(values).sort().join(', ')} — ` +
      `every one of them declared by the \`.env.example\` the command wrote — and supplied ` +
      `nothing at all through the environment. The ${String(generated.length)} value` +
      `${generated.length === 1 ? '' : 's'} already in that file ` +
      `${generated.length === 1 ? 'is' : 'are'} the command's own ` +
      `(${generated.join(', ') || 'none'}), untouched.`,
  );
}

/** The variable names the instance's own `.env.example` declares. */
function declaredVariables(target: string): readonly string[] {
  const path = join(target, '.env.example');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
}

/** A10 — a module set that cannot compose, refused before anything is written. */
async function measureRefusal(
  binary: string,
  hostDir: string,
  target: string,
): Promise<AssertionResult> {
  const sentences = await requiredModuleSentences(hostDir);
  const result = run(binary, ['new', 'instance', target, '--module', 'catalog'], {
    cwd: hostDir,
  });
  return evaluateA10({
    exitCode: result.code,
    output: result.output,
    wroteAnything: existsSync(target) && readdirSync(target).length > 0,
    platformSentences: sentences,
  });
}

/**
 * The sentences the installed manifests give for being required.
 *
 * Read out of the packages this run resolved — the same artefacts the command
 * read — so A10 holds the refusal to the platform's own words rather than to a
 * list in this file (R5.6, D-100). A manifest that will not load is skipped
 * rather than refused: the assertion needs one sentence to hold the refusal to,
 * and {@link evaluateA10} reports "none at all" as `unmeasured`.
 */
async function requiredModuleSentences(hostDir: string): Promise<readonly string[]> {
  const root = join(hostDir, 'node_modules', SCOPE);
  if (!existsSync(root)) return [];
  const sentences: string[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const packageManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      endora?: { type?: string };
      exports?: Record<string, unknown>;
    };
    if (packageManifest.endora?.type !== 'module') continue;
    const rootExport = packageManifest.exports?.['.'];
    const target =
      typeof rootExport === 'string'
        ? rootExport
        : ((rootExport as { default?: string } | undefined)?.default ?? null);
    if (target === null) continue;
    try {
      const loaded = (await import(pathToFileURL(join(dir, target)).href)) as {
        manifest?: { activation?: { nonDeactivatable?: boolean; reason?: string } };
      };
      const activation = loaded.manifest?.activation;
      if (activation?.nonDeactivatable === true && typeof activation.reason === 'string') {
        sentences.push(activation.reason);
      }
    } catch {
      // A manifest that will not load contributes no sentence. It is not a
      // refusal: this assertion needs one to hold the command to, and zero of
      // them is reported as `unmeasured` by the judgement rather than here.
    }
  }
  return sentences;
}

/** The class names the instance's own configuration puts in execution order. */
function computedMigrationOrder(
  backendDir: string,
  environment: NodeJS.ProcessEnv,
): readonly string[] | null {
  const config = join(backendDir, 'dist', 'mikro-orm.config.js');
  if (!existsSync(config)) return null;
  const probe =
    `const module = await import(${JSON.stringify(pathToFileURL(config).href)});` +
    `const config = await module.default();` +
    `console.log(JSON.stringify((config.migrations?.migrationsList ?? []).map((e) => e.name)));`;
  // `--env-file-if-exists=../.env`, the instance's own spelling: this probe
  // loads the instance's compiled MikroORM configuration, which reads
  // `DATABASE_URL`, and since G3 that value lives in the `.env` a client filled
  // in rather than in anybody's process environment. Without the flag the probe
  // reads nothing and A3 goes `unmeasured` over a migration that ran.
  const result = run(
    process.execPath,
    ['--env-file-if-exists=../.env', '--input-type=module', '-e', probe],
    { cwd: backendDir, env: environment },
  );
  if (result.code !== 0) return null;
  const line = result.output.trim().split('\n').pop();
  if (line === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * What `mikro_orm_migrations` recorded, in the order applied.
 *
 * The table's **absence** is reported apart from a read that failed, and that
 * is the whole reason this is not a `string[] | null`: the database is this
 * run's own and was created empty a moment earlier, so "no migrations table"
 * is a finding about a migrate step that claimed to succeed, while "the query
 * threw" is this run not being able to see. Collapsing the two would report the
 * first as `unmeasured` — which is what it did, over a root script that exits 0
 * and runs nothing.
 */
async function appliedMigrations(dsn: string): Promise<AppliedMigrations> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
    const present = await client.query<{ count: string }>(
      "select count(*)::text as count from information_schema.tables " +
        "where table_schema = current_schema() and table_name = 'mikro_orm_migrations'",
    );
    if (present.rows[0]?.count === '0') return { kind: 'absent' };
    const result = await client.query<{ name: string }>(
      'select name from mikro_orm_migrations order by id asc',
    );
    return { kind: 'read', names: result.rows.map((row) => row.name) };
  } catch (error) {
    return { kind: 'unreadable', error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Create the run's own database, or refuse. */
async function resetDatabase(adminUrl: string, databaseName: string): Promise<void> {
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
}

async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`drop database if exists "${databaseName}" with (force)`);
  } catch {
    // The run is over; a database left behind is a nuisance and not a finding.
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The administrator A15 logs in as.
 *
 * The password is this run's own and never leaves it: the database it is
 * created in is created and dropped by the same run, and the only reader is the
 * login three functions down.
 */
const ADMIN_EMAIL = 'acceptance@endora.test';
const ADMIN_PASSWORD = 'Acceptance-Instance-1!';

/** Everything one boot of the created instance can be asked while it is up. */
interface BootObservation {
  readonly healthStatus: number | null;
  /** The module ids the presence route enumerated, in its own order. */
  readonly enumerated: readonly string[] | null;
  /** `"<METHOD> <path>"` for every endpoint the served OpenAPI document holds. */
  readonly servedRoutes: readonly string[] | null;
  /** One entry per extra path the caller asked for: its status and its body. */
  readonly probes: ReadonlyMap<string, { status: number; body: unknown }>;
  /** `null` when nothing was served, or when no administrator was created. */
  readonly loginStatus: number | null;
  readonly sessionCookie: boolean;
  readonly loginBody: string;
  readonly output: string;
}

/**
 * A4 — one boot of the created instance, through its own `start` script — and
 * every other question a running instance is the only thing that can answer.
 *
 * The surfaces are read in **one** boot rather than one each, and that is not
 * only economy: A7's whole subject is that the *same* composition that serves
 * the API is the one that enumerates the modules and produced the bundle, and
 * A15's own note gives the same reason for its login — a second `start` is a
 * second process whose failure would be a different finding. `probePaths` is
 * the caller's own list: A8's overlay module answers on a route only that
 * assertion knows about.
 */
async function bootOnce(
  target: string,
  environment: NodeJS.ProcessEnv,
  /**
   * Attempt A15's login. `false` when `admin:create` did not succeed, so a
   * login that could not have worked is never reported as a failing one.
   */
  withLogin: boolean,
  probePaths: readonly string[] = [],
): Promise<BootObservation> {
  const port = 3400 + Math.floor(Math.random() * 300);
  const child = spawn('pnpm', ['run', 'start'], {
    cwd: target,
    env: { ...process.env, ...environment, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const unserved = (): BootObservation => ({
    healthStatus: null,
    enumerated: null,
    servedRoutes: null,
    probes: new Map(),
    loginStatus: null,
    sessionCookie: false,
    loginBody: '',
    output,
  });
  const ask = async (path: string): Promise<{ status: number; body: unknown } | null> => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // A route that answers something other than JSON is still an answer;
        // the status is what the caller asked about.
      }
      return { status: response.status, body };
    } catch {
      return null;
    }
  };
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (child.exitCode !== null) return unserved();
      if (Date.now() > deadline) return unserved();
      await new Promise((wait) => setTimeout(wait, 2_000));
      const health = await ask(HEALTH_PATH);
      if (health === null) continue;

      const presence = await ask(PRESENCE_PATH);
      const modules = (presence?.body as { modules?: readonly unknown[] } | undefined)?.modules;
      const enumerated = Array.isArray(modules)
        ? modules
            .map((entry) => (entry as { id?: unknown }).id)
            .filter((id): id is string => typeof id === 'string')
        : null;

      // The API surface, read off the document the platform generates from the
      // routes Fastify actually registered — never off a list of what this
      // composition was supposed to serve.
      const document = await ask(OPENAPI_PATH);
      const paths = (document?.body as { paths?: Record<string, unknown> } | undefined)?.paths;
      const servedRoutes =
        document?.status === 200 && paths !== undefined && paths !== null
          ? Object.entries(paths).flatMap(([path, operations]) =>
              Object.keys(operations as Record<string, unknown>).map(
                (method) => `${method.toUpperCase()} ${path}`,
              ),
            )
          : null;

      const probes = new Map<string, { status: number; body: unknown }>();
      for (const path of probePaths) {
        const answer = await ask(path);
        if (answer !== null) probes.set(path, answer);
      }
      // A15's second half. It is asked on the same boot rather than on one of
      // its own for the reason A4's probe is: a second `start` is a second
      // process whose failure would be a different finding.
      let loginStatus: number | null = null;
      let sessionCookie = false;
      let loginBody = '';
      if (withLogin) {
        try {
          const login = await fetch(`http://127.0.0.1:${String(port)}${ADMIN_LOGIN_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
            signal: AbortSignal.timeout(20_000),
          });
          loginStatus = login.status;
          sessionCookie = (login.headers.getSetCookie?.() ?? []).some((cookie) =>
            cookie.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`),
          );
          loginBody = await login.text();
        } catch (thrown) {
          // Not a `catch` that decides anything: the transport failing is a
          // measurement of its own and is reported as `loginStatus: null` with
          // the reason in the body, never as a passing login.
          loginBody = thrown instanceof Error ? thrown.message : String(thrown);
        }
      }
      return {
        healthStatus: health.status,
        enumerated,
        servedRoutes,
        probes,
        loginStatus,
        sessionCookie,
        loginBody,
        output,
      };
    }
  } finally {
    child.kill('SIGTERM');
  }
}

/**
 * Every file under a directory whose name ends in one of `suffixes`.
 *
 * A plain recursive walk, and `node_modules` is not skipped by name: the two
 * callers below are given a package's own directory or the admin project's
 * `dist`, neither of which holds one.
 */
function filesWithSuffix(root: string, suffixes: readonly string[]): readonly string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...filesWithSuffix(full, suffixes));
    else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) found.push(full);
  }
  return found;
}

/**
 * The module packages this instance installed, with the admin layer each one
 * **publishes** — read off its own `exports` map.
 *
 * Deliberately a second reading of the question the CLI's generator answers,
 * and R6.3's A5 is what asks for it: the generator says which layers it
 * imported and the packages say which layers they publish, so the criterion is
 * not one program asserting itself. It is the same arrangement `evaluateA3`
 * already has, where the order is recomputed rather than read back.
 *
 * A subpath is an admin layer when its target lands in a directory called
 * `admin`; the subpath's **name** is not read, because a package may call it
 * anything.
 */
function installedModules(
  target: string,
): readonly { id: string; packageName: string; dir: string; admin: boolean }[] {
  const scope = join(target, 'node_modules', SCOPE);
  if (!existsSync(scope)) return [];
  const found: { id: string; packageName: string; dir: string; admin: boolean }[] = [];
  for (const entry of readdirSync(scope)) {
    const dir = join(scope, entry);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      endora?: { type?: string; id?: string };
      exports?: Record<string, unknown>;
    };
    if (manifest.endora?.type !== 'module' || typeof manifest.endora.id !== 'string') continue;
    const admin = Object.entries(manifest.exports ?? {}).some(([subpath, targetPath]) => {
      if (subpath === './package.json') return false;
      const spelled =
        typeof targetPath === 'string'
          ? targetPath
          : typeof (targetPath as { default?: unknown } | null)?.default === 'string'
            ? ((targetPath as { default: string }).default)
            : null;
      if (spelled === null) return false;
      return dirname(spelled.replace(/^\.\//, '')).split('/').pop() === 'admin';
    });
    found.push({
      id: manifest.endora.id,
      packageName: manifest.name ?? `${SCOPE}/${entry}`,
      dir,
      admin,
    });
  }
  return found.sort((left, right) => left.id.localeCompare(right.id));
}

/** A5's evidence: the module ids the built bundle names, and how much it read. */
function bundleEvidence(adminDist: string): { named: readonly string[]; bytes: number } {
  const named = new Set<string>();
  let bytes = 0;
  for (const file of filesWithSuffix(adminDist, ['.js', '.mjs'])) {
    const text = readFileSync(file, 'utf8');
    bytes += text.length;
    // The registry's own shape, which survives minification: the property is a
    // plain object key and esbuild does not mangle one.
    for (const match of text.matchAll(/moduleId\s*:\s*["']([a-z0-9_]+)["']/g)) {
      named.add(match[1]!);
    }
  }
  return { named: [...named].sort(), bytes };
}

/**
 * Class tokens a tree writes, read **only** out of a `class` / `className`
 * position.
 *
 * Every string literal was the first spelling and it is far too wide: measured
 * on the criterion's own tree, it made i18n keys (`permission-authority`),
 * palette action ids (`open-audit-log`) and DOM ids (`f-action`) look like
 * classes only one package uses, and then reported their absence from the
 * stylesheet as that package having gone unscanned — a red about the probe
 * wearing the costume of a red about the product. The attribute position is
 * what makes a token a class.
 *
 * A token carrying a `.` or a `/` is out of the population by construction: the
 * compiled CSS escapes it (`.space-y-0\.5`), so it can never be matched by
 * {@link cssClasses} and would be a permanent false absence. One witness per
 * package is all this needs.
 */
function classTokensIn(root: string, suffixes: readonly string[]): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const file of filesWithSuffix(root, suffixes)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bclass(?:Name)?\s*[:=]\s*["'`]([^"'`]{0,600})["'`]/g)) {
      for (const token of match[1]!.split(/\s+/)) {
        if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(token) && token.length >= 4) tokens.add(token);
      }
    }
  }
  return tokens;
}

/** The class names a compiled stylesheet actually defines a rule for. */
function cssClasses(files: readonly string[]): { classes: ReadonlySet<string>; bytes: number } {
  const classes = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    bytes += text.length;
    for (const match of text.matchAll(/\.(-?[a-z][a-zA-Z0-9_-]*)(?=[\s{,.:>~+)\]])/g)) {
      classes.add(match[1]!);
    }
  }
  return { classes, bytes };
}

/**
 * A13's reading: which packages' own classes survived into the built stylesheet.
 *
 * "Its own" is derived rather than declared — a class this package uses that no
 * other installed package and no file of the admin project uses — so the
 * witness cannot have arrived from anywhere but this package's sources having
 * been scanned. That is the only evidence that distinguishes a stylesheet built
 * from the generated enumeration from one built without it, which is the whole
 * of FR-023.
 */
function stylesheetWitnesses(
  target: string,
  adminDist: string,
): AdminStylesheetObservation {
  const css = cssClasses(filesWithSuffix(adminDist, ['.css']));
  const subjects: { packageName: string; kind: 'shell' | 'module'; dir: string }[] = [];
  // The shell is the **admin member's** dependency, so it is installed there
  // and not at the root. Reading the root alone gave it an empty token set,
  // which silently widened every module's "own" classes by everything the
  // shell also uses — and reported seven modules as unscanned on that basis.
  const shellDir = [target, ...workspaceMemberDirectories(target)]
    .map((root) => join(root, 'node_modules', SCOPE, 'admin-shell'))
    .find((candidate) => existsSync(candidate));
  if (shellDir !== undefined) {
    subjects.push({ packageName: `${SCOPE}/admin-shell`, kind: 'shell', dir: shellDir });
  }
  for (const module of installedModules(target)) {
    if (!module.admin) continue;
    subjects.push({ packageName: module.packageName, kind: 'module', dir: module.dir });
  }

  // The design system's own stylesheet is **imported**, not scanned, so every
  // class it defines is in the bundle whether or not any package was scanned.
  // Those are evidence of nothing and are subtracted from every package's set —
  // in both directions: a missing one is not a defect, and a present one is not
  // a witness. Derived from the file the admin project imports rather than from
  // a prefix written down here.
  const designSystem = new Set<string>();
  for (const root of [target, ...workspaceMemberDirectories(target)]) {
    const theme = join(root, 'node_modules', SCOPE, 'admin-kit', 'theme.css');
    if (!existsSync(theme)) continue;
    for (const name of cssClasses([theme]).classes) designSystem.add(name);
    break;
  }

  const tokensByPackage = new Map<string, ReadonlySet<string>>();
  for (const subject of subjects) {
    const scanned = classTokensIn(subject.dir, ['.js', '.mjs']);
    tokensByPackage.set(
      subject.packageName,
      new Set([...scanned].filter((token) => !designSystem.has(token))),
    );
  }
  // The admin project's own sources are excluded from every package's "own"
  // set: a class the client's own `index.css` or `main.tsx` uses reaches the
  // stylesheet through Tailwind's automatic detection, which is rooted at the
  // Vite project and would be there with no enumeration at all.
  const projectTokens = classTokensIn(join(target, 'admin', 'src'), ['.tsx', '.ts', '.css']);

  const packages = subjects.map((subject) => {
    const own = tokensByPackage.get(subject.packageName)!;
    const unique = [...own].filter((token) => {
      if (projectTokens.has(token)) return false;
      for (const [name, tokens] of tokensByPackage) {
        if (name !== subject.packageName && tokens.has(token)) return false;
      }
      return true;
    });
    return {
      packageName: subject.packageName,
      kind: subject.kind,
      unique: unique.length,
      witnesses: unique.filter((token) => css.classes.has(token)).sort().slice(0, 3),
    };
  });
  return { built: css.bytes > 0, bytes: css.bytes, packages };
}

/**
 * What the build said, with Docusaurus's own broken-link block preferred.
 *
 * A stack trace's last five lines name a file inside `node_modules` and tell a
 * reader nothing; the block above it names the page and the link. It is
 * extracted rather than the whole output reported because this ends up on one
 * line of a report.
 */
function brokenLinkEvidence(output: string): string {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.includes('found broken links'));
  if (start === -1) return lines.slice(-5).map((line) => line.trim()).join(' / ');
  const block = lines
    .slice(start)
    .filter((line) => /Broken link on source page|-> linking to/.test(line))
    .map((line) => line.trim());
  return `Docusaurus found broken links: ${block.join(' ')}`;
}

/**
 * A6, over the site the instance's own `build` script produced.
 *
 * Every list is **derived from the tree**, never written here:
 *
 *   * the **expectation** is each installed module package's own `docs/` layer
 *     at the package root — the directory feature 100 has a module ship in its
 *     tarball — folded onto the slug the navigation would name it by. A module
 *     that documents nothing is not expected and is not a finding;
 *   * the **navigation** is read out of the generated fragment the instance
 *     wrote, so it is what Docusaurus was handed and not what we would have
 *     rendered;
 *   * the **routes** are the HTML the build emitted, which is the only evidence
 *     that a named page is a page a reader can reach.
 *
 * The slug derivation is `slugForModule`'s and is applied here rather than
 * imported for one reason: this file reads a **client's** tree, and the
 * navigation entries it compares against were rendered by the CLI the instance
 * installed — so taking the ids out of the fragment and folding the package ids
 * the same way is the comparison. A third spelling would be a third answer.
 */
function docsSiteObservation(
  target: string,
  build: { code: number; output: string } | null,
): DocsSiteObservation {
  const member = join(target, 'docs');
  const site = join(member, 'build');
  const fragment = join(member, 'sidebars.modules.generated.js');
  const navigation = existsSync(fragment) ? readFileSync(fragment, 'utf8') : '';
  // `{ type: 'doc', id: 'modules/<slug>' }` and the category form's `link`,
  // which is the shape a module with sub-pages gets. Both name the module's
  // own entry page; the reference category is a different population and is
  // not what "the installed modules' pages" means.
  // **The subject is the module, never the slug.** A module's page is named by
  // the module rather than named *after* it: `admin_roles` ships
  // `admin_roles.md` and `assets_library` ships `assets-library/`, and D-200's
  // rule is that a slug names a module when it *folds* onto the id — so a
  // comparison of slugs reports every module whose page uses the other spelling
  // as both missing and extra, which is what the first run of this assertion
  // did. The fold is applied to the **navigation's** slugs, and the expectation
  // stays the installed module's own id.
  const documented = installedModules(target).filter((module) =>
    existsSync(join(module.dir, 'docs')),
  );
  const expected = documented.map((module) => module.id).sort();
  const folds = (slug: string, moduleId: string): boolean =>
    slug === moduleId || slug === moduleId.replace(/^_/, '').split('_').join('-');
  const entries = [...navigation.matchAll(/id: 'modules\/([^'/]+)(\/[^']*)?'/g)]
    .map((match) => ({ slug: match[1]!, tail: match[2] ?? '' }))
    .filter((entry) => !entry.slug.startsWith('module-map'));
  const named = [
    ...new Set(
      entries.flatMap((entry) =>
        expected.filter((moduleId) => folds(entry.slug, moduleId)),
      ),
    ),
  ].sort();
  // A navigation entry naming a slug no installed module folds onto: the other
  // direction, and it has to be counted as a module id or the assertion cannot
  // report it beside the first.
  const unclaimed = entries
    .filter((entry) => !expected.some((moduleId) => folds(entry.slug, moduleId)))
    .map((entry) => `${entry.slug}${entry.tail}`);
  const html = existsSync(site) ? filesWithSuffix(site, ['.html']) : [];
  const routeOf = (entry: { slug: string; tail: string }): string =>
    `${entry.slug}${entry.tail}`.replace(/\/index$/, '');
  const served = (predicate: (entry: { slug: string; tail: string }) => boolean): boolean =>
    entries.some(
      (entry) =>
        predicate(entry) &&
        html.some((file) => file.endsWith(join('modules', routeOf(entry), 'index.html'))),
    );
  // An unclaimed entry is already reported as `extra`; it is measured for a
  // route as well so that it is not reported a second time as unrouted.
  const routed = [
    ...named.filter((moduleId) => served((entry) => folds(entry.slug, moduleId))),
    ...unclaimed.filter((route) => served((entry) => routeOf(entry) === route.replace(/\/index$/, ''))),
  ];
  return {
    present: true,
    omission: null,
    // **Emitting is not building.** Docusaurus writes the whole site and *then*
    // runs its broken-link check, so `docs/build/` is full on a run that
    // exited 1 — measured, 72 pages beside a failure. A predicate that only
    // looked for HTML would report a site nobody can publish as built, which is
    // the silent green `onBrokenLinks: 'throw'` exists to prevent.
    //
    // The exit code is the **root** `build` script's, which reaches every
    // member (§2.5), so an admin failure lands here too. That is the
    // conservative direction — this assertion says "the documentation site
    // builds", and it does not, whichever member broke the run — and the
    // evidence below names which.
    built: build?.code === 0 && html.length > 0,
    buildOutput: brokenLinkEvidence(build?.output ?? ''),
    expected,
    named: [...named, ...unclaimed].sort(),
    routed,
    pages: html.length,
  };
}

/**
 * A7's expectation: the module packages this run packed and the instance did
 * **not** install, and the route identities each one's published `./backend`
 * owns.
 *
 * Two authors, which is `evaluateA5`'s arrangement one surface over: the
 * expectation is derived from the absent packages' own published layers, and
 * the evidence is the document the running instance serves. Deriving it from
 * the packages rather than from their **names** is what makes the assertion
 * exact — a bare segment match reports `promotions`' own
 * `/rule-targets/payment-methods` as the absent `payment_methods` module
 * advertising itself, which is a red about English rather than about the
 * instance.
 */
function absentModules(
  target: string,
  installed: readonly string[],
): { absent: readonly string[]; routes: ReadonlyMap<string, string> } {
  const installedIds = new Set(installed);
  const packages = discoverModulePackages(REPO_ROOT).filter(
    (pkg) => !installedIds.has(pkg.moduleId),
  );
  const scan = instanceComposition({
    packages,
    platform: scanInstalledPlatformPackage(target),
  });
  const routes = new Map<string, string>();
  for (const [identity, owner] of scan.environment.routes) {
    // A route the derivation could not attribute is the **platform's** own —
    // an absent package's sources name `/api/v1/_health` in a comment and the
    // walk reads the text, not the registration. Only an owned identity is an
    // absent module's endpoint.
    if (owner !== null) routes.set(identity, owner);
  }
  return { absent: packages.map((pkg) => pkg.moduleId).sort(), routes };
}

/**
 * The module ids entitled to be enumerated without being an installed package.
 *
 * Read out of the **installed platform package**, which is the only thing that
 * knows what modules it ships of its own: `_lifecycle` is composed by the
 * platform and by no `pnpm add`, so a completeness check that did not know it
 * would report the platform's own module as an intruder. `null` is the state
 * where this run could not read it at all, which `evaluateA7` reports rather
 * than folding into a red.
 */
async function platformOwnModuleIds(
  target: string,
  overlayModules: readonly string[],
): Promise<readonly string[] | null> {
  for (const root of [target, ...workspaceMemberDirectories(target)]) {
    let resolved: string;
    try {
      resolved = createRequire(join(root, 'noop.js')).resolve(`${SCOPE}/platform/lifecycle`);
    } catch {
      continue;
    }
    try {
      const loaded = (await import(pathToFileURL(resolved).href)) as {
        manifest?: { id?: unknown };
      };
      const id = loaded.manifest?.id;
      if (typeof id === 'string') return [id, ...overlayModules];
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * A8's fixture, written into the tree the command created.
 *
 * **TypeScript, and an instance compiles none of it.** `apps/` is outside the
 * backend member's `rootDir`, so the overlay module's own files are read by
 * Node's type stripping at import and by `endora generate`'s walk. The type
 * stripping is the part that has a floor: it is unflagged only above the
 * `engines.node` this tree declares, which is why a run on the pinned CI image
 * is not the same measurement as a run on a developer's Node.
 *
 * The derivation used to place a seam call only on a receiver it could see
 * annotated `ModuleContext`, so a JavaScript overlay module rendered a **clean**
 * report over a tree full of decorations, with no finding either. That is
 * repaired (`specs/124-instance-customisation-gap/` FR-008, FR-009): the first
 * parameter of an exported `registerModule` is a context receiver whatever its
 * spelling, and a seam call the walk still cannot place refuses the run instead
 * of printing a pass. A `.ts` fixture is kept because that is what both
 * published pages instruct a client to write.
 *
 * The declared reason is written beside the module for the same run: a derived
 * divergence with no sentence in `divergence.ts` is itself a finding, so a
 * fixture that omitted it would red A8 on the criterion's own omission.
 */
function writeOverlayModule(
  target: string,
  deployment: string,
): { written: readonly string[] } | { failure: string } {
  const moduleDir = join(target, 'apps', deployment, 'modules', OVERLAY_MODULE_ID);
  const declarationPath = join(target, 'apps', deployment, 'divergence.ts');
  if (!existsSync(declarationPath)) {
    return {
      failure:
        `the created tree holds no \`apps/${deployment}/divergence.ts\`, so this deployment has ` +
        'no declaration to write the overlay module\'s own sentence into',
    };
  }
  const declaration = readFileSync(declarationPath, 'utf8');
  const anchor = '  reasons: {},';
  if (!declaration.includes(anchor)) {
    return {
      failure:
        `\`apps/${deployment}/divergence.ts\` does not carry the empty \`reasons\` map the ` +
        'command writes, so the criterion cannot declare its own divergence and the report ' +
        'would record one with no sentence',
    };
  }
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(
    join(moduleDir, 'manifest.ts'),
    `// Written by \`acceptance:instance\` — R6.3 A8's own fixture.\n` +
      `//\n` +
      `// A literal rather than \`defineModuleManifest\`: an overlay module in an instance is\n` +
      `// imported by Node's type stripping and by nothing else, and an instance's own manifest\n` +
      `// declares none of the \`@endora-commerce\` packages a client would import here.\n` +
      `export const manifest = {\n` +
      `  id: '${OVERLAY_MODULE_ID}',\n` +
      `  name: 'Instance acceptance overlay',\n` +
      `  description: "The acceptance criterion's own overlay module.",\n` +
      `  version: '1.0.0',\n` +
      `  dependencies: [],\n` +
      `};\n`,
  );
  writeFileSync(
    join(moduleDir, 'backend.ts'),
    `// Written by \`acceptance:instance\` — R6.3 A8's own fixture.\n` +
      `//\n` +
      `// One registration, one decoration of it, and one route that reports whether the wrap\n` +
      `// applied. The route is the composed half's evidence and the decoration is the report's;\n` +
      `// see \`OVERLAY_MODULE_ID\` in \`backend/scripts/acceptance/instance.ts\` for why the\n` +
      `// decorated name is this module's own and not a platform or package registration.\n` +
      `import type { ModuleContext } from '${SCOPE}/platform/kernel';\n` +
      `\n` +
      `const MARKER = '${OVERLAY_MARKER}';\n` +
      `\n` +
      `export class InstanceAcceptanceOverlayService {\n` +
      `  greeting(): string {\n` +
      `    return '${OVERLAY_MODULE_ID}';\n` +
      `  }\n` +
      `}\n` +
      `\n` +
      `export function registerModule(ctx: ModuleContext): void {\n` +
      `  ctx.di.register({\n` +
      `    ${OVERLAY_REGISTRATION}: ctx.asClass(InstanceAcceptanceOverlayService).singleton(),\n` +
      `  });\n` +
      `\n` +
      `  ctx.di.decorate('${OVERLAY_REGISTRATION}', (inner: InstanceAcceptanceOverlayService) => ({\n` +
      `    greeting: (): string => \`\${inner.greeting()}#\${MARKER}\`,\n` +
      `  }));\n` +
      `\n` +
      `  ctx.routes(async (app) => {\n` +
      `    app.get('${OVERLAY_PROBE_PATH}', async () => {\n` +
      `      const cradle = ctx.cradle() as Record<string, InstanceAcceptanceOverlayService>;\n` +
      `      let greeting: string | null = null;\n` +
      `      let error: string | null = null;\n` +
      `      try {\n` +
      `        greeting = cradle['${OVERLAY_REGISTRATION}']?.greeting() ?? null;\n` +
      `      } catch (thrown) {\n` +
      `        error = thrown instanceof Error ? thrown.message : String(thrown);\n` +
      `      }\n` +
      `      return { module: '${OVERLAY_MODULE_ID}', greeting, error };\n` +
      `    });\n` +
      `  });\n` +
      `}\n`,
  );
  writeFileSync(
    declarationPath,
    declaration.replace(
      anchor,
      `  reasons: {\n` +
        `    'decoration:${OVERLAY_MODULE_ID}:${OVERLAY_REGISTRATION}':\n` +
        `      '${OVERLAY_REASON}',\n` +
        `    'registration:${OVERLAY_MODULE_ID}:${OVERLAY_REGISTRATION}':\n` +
        `      '${OVERLAY_REASON}',\n` +
        `  },`,
    ),
  );
  return {
    written: [
      `apps/${deployment}/modules/${OVERLAY_MODULE_ID}/manifest.ts`,
      `apps/${deployment}/modules/${OVERLAY_MODULE_ID}/backend.ts`,
    ],
  };
}

/** The deployments the created tree holds — one directory under `apps/`. */
function deploymentsIn(target: string): readonly string[] {
  const appsRoot = join(target, 'apps');
  if (!existsSync(appsRoot)) return [];
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * A8's other half: the report the instance's own `generate` script renders over
 * its `apps/` tree, and the findings it printed getting there.
 *
 * Run through the instance's own script rather than through this checkout's
 * renderer, which is the whole point of T138a: a client's instance renders one
 * or it does not.
 */
function renderedDivergence(
  target: string,
  deployment: string,
  environment: NodeJS.ProcessEnv,
): {
  entries: readonly DivergenceReportEntry[] | null;
  findings: readonly string[];
  failure: string | null;
} {
  const generated = run('pnpm', ['run', 'generate'], { cwd: target, env: environment });
  const findings = generated.output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\[[a-z-]+]/.test(line));
  const artefact = join(target, 'apps', deployment, 'divergence.generated.json');
  if (!existsSync(artefact)) {
    return {
      entries: null,
      findings,
      failure:
        `the instance's own \`generate\` script exited ${String(generated.code)} and wrote no ` +
        `apps/${deployment}/divergence.generated.json: ` +
        `${generated.output.trim().split('\n').slice(-4).join(' / ')}`,
    };
  }
  try {
    const report = JSON.parse(readFileSync(artefact, 'utf8')) as {
      entries?: readonly DivergenceReportEntry[];
    };
    return { entries: report.entries ?? [], findings, failure: null };
  } catch (error) {
    return {
      entries: null,
      findings,
      failure: `${artefact} is not readable as JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * A8, end to end: write the overlay module, render the report, install it and
 * boot the instance again.
 *
 * **A second boot, deliberately.** A4's subject is the instance as the command
 * wrote it, and an overlay module changes what that instance is — measurably:
 * the presence route enumerates it and the boot's i18n reconcile does not,
 * because `defaultComposition` composes the deployment's overlay modules and
 * passes `overlay: async () => []` to the manifest resolution beside it. Folding
 * A8's fixture into A4's boot would move A4's own verdict on a tree the client
 * never has, so the fixture is written after A4 has answered and the arithmetic
 * it breaks is reported as a note.
 */
async function measureOverlay(
  target: string,
  deployment: string,
  environment: NodeJS.ProcessEnv,
): Promise<OverlayModuleObservation> {
  const unreachable = (failure: string): OverlayModuleObservation => ({
    moduleId: OVERLAY_MODULE_ID,
    decorated: OVERLAY_REGISTRATION,
    composed: 'unreachable',
    decorationApplied: null,
    bootOutput: '',
    entries: null,
    findings: [],
    renderFailure: failure,
  });

  const fixture = writeOverlayModule(target, deployment);
  if ('failure' in fixture) return unreachable(fixture.failure);
  notes.push(
    `wrote ${fixture.written.join(' and ')} — A8's own fixture, and the one decoration a ` +
      `booting instance accepts: the two it refuses are recorded beside \`OVERLAY_MODULE_ID\``,
  );

  const rendered = renderedDivergence(target, deployment, environment);

  // The overlay module is a module: its `module_registrations` row is written
  // by `module:install` and by no boot (D-157.6(b)), exactly as a package's is.
  const installed = run('pnpm', ['run', 'module:install', '--all'], {
    cwd: target,
    env: environment,
  });
  if (installed.code !== 0) {
    notes.push(
      `the instance's own \`module:install --all\` exited ${String(installed.code)} over the ` +
        `tree carrying A8's overlay module: ` +
        failureExcerpt(installed.output, 3),
    );
  }

  // `withLogin: false` — A15's administrator is A4's boot's subject and was
  // already measured there; asking again would report one fact twice and, on a
  // second failure, as two.
  const boot = await bootOnce(target, environment, false, [OVERLAY_PROBE_PATH]);
  const probe = boot.probes.get(OVERLAY_PROBE_PATH);
  const composed =
    boot.healthStatus === null
      ? ('unreachable' as const)
      : probe?.status === 200
        ? ('answered' as const)
        : ('refused' as const);
  const greeting = (probe?.body as { greeting?: unknown } | undefined)?.greeting;

  // The arithmetic A4 asserts, re-read over the tree that now holds an overlay
  // module. It is a note rather than a verdict because A4's subject is the
  // other tree — and it is not silent, because a population the platform
  // enumerates and its own reconcile has never heard of is the state
  // `overlayModuleIdsUnder`'s own doc block says the two seams must never be in.
  const reconcile = reconcileFigures(boot.output);
  if (reconcile !== null && boot.enumerated !== null) {
    const accounted = reconcile.installed + reconcile.skipped + reconcile.failed;
    if (accounted !== boot.enumerated.length) {
      notes.push(
        `with one overlay module in \`apps/${deployment}/modules/\`, the boot reconcile accounts ` +
          `for ${String(accounted)} modules and the presence route enumerates ` +
          `${String(boot.enumerated.length)}. A4's arithmetic holds on the tree the command ` +
          `wrote and not on one carrying an overlay module: \`defaultComposition\` composes the ` +
          `deployment's overlay modules and passes \`overlay: async () => []\` to the manifest ` +
          `resolution beside them, so an overlay module is in the container, in the permission ` +
          `gate and in the presence projection, and in \`lifecycleManifestRegistry\` it is not. ` +
          `Reported, not repaired — it belongs to \`@endora-commerce/platform\``,
      );
    }
  }

  return {
    moduleId: OVERLAY_MODULE_ID,
    decorated: OVERLAY_REGISTRATION,
    composed,
    decorationApplied:
      probe === undefined
        ? null
        : typeof greeting === 'string'
          ? greeting.endsWith(`#${OVERLAY_MARKER}`)
          : false,
    bootOutput: boot.output,
    entries: rendered.entries,
    findings: rendered.findings,
    renderFailure: rendered.failure,
  };
}

/**
 * A9 — the tenant guard, read by a process that resolves the **instance's**
 * packages.
 *
 * A separate process for `instance-probe.ts`' reason: the answer has to come
 * from the platform the client installed, not from the one this checkout
 * builds. Its `cwd` is the instance's backend member rather than ours, because
 * MikroORM's own version check reads `@mikro-orm/*` relative to the working
 * directory — from here it found this repository's copy beside the instance's
 * and refused the pair.
 */
function measureTenancy(target: string, environment: NodeJS.ProcessEnv): TenancyGuardObservation {
  const probe = join(SCRIPT_DIR, 'instance-tenancy-probe.ts');
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  const inconclusive = (reason: string): TenancyGuardObservation => ({
    inconclusive: reason,
    entity: null,
    organizations: [],
    unscopedRead: null,
    refusalName: null,
    systemScopeOrganizations: [],
    narrowedOrganizations: null,
  });
  if (!existsSync(tsx)) return inconclusive(`${tsx} is not there, so the probe cannot be run`);
  // `--env-file-if-exists=../.env`, the instance's own spelling, and the reason
  // is `specs/123-oss-install-experience/` G3: this criterion supplies **nothing**
  // through the environment. `DATABASE_URL` lives in the `.env` a client filled
  // in — the file the instance's own scripts read the same way — and without the
  // flag the probe throws `DATABASE_URL must be set` and A9 goes `unmeasured`
  // over a schema that is right there. `cwd` is the instance's backend member,
  // so the file is one directory up.
  const result = run(tsx, ['--env-file-if-exists=../.env', probe], {
    cwd: join(target, 'backend'),
    env: { ...environment, ACCEPTANCE_INSTANCE_ROOT: target },
  });
  const line = result.output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.startsWith('ACCEPTANCE_JSON '));
  if (line === undefined) {
    return inconclusive(
      `the tenancy probe printed no verdict (exit ${String(result.code)}): ` +
        `${result.output.trim().split('\n').slice(-4).join(' / ')}`,
    );
  }
  const payload = JSON.parse(line.slice('ACCEPTANCE_JSON '.length)) as {
    observation?: Omit<TenancyGuardObservation, 'inconclusive'>;
    inconclusive?: string;
    probeError?: string;
  };
  if (payload.inconclusive !== undefined) return inconclusive(payload.inconclusive);
  if (payload.probeError !== undefined) {
    // A probe that threw where it was supposed to answer measured nothing, so
    // it is neither colour — reporting it as red would be a criterion that
    // fails when its own harness does.
    return inconclusive(`the tenancy probe threw: ${payload.probeError.slice(0, 600)}`);
  }
  if (payload.observation === undefined) {
    return inconclusive('the tenancy probe answered with neither an observation nor a reason');
  }
  return { inconclusive: null, ...payload.observation };
}

/**
 * The assertions this criterion cannot measure today, each with the contract or
 * task that retires it.
 *
 * They are **declared** rather than attempted, and the difference matters: a
 * step that ran and found nothing is a measurement, and these have no subject
 * at all. Writing a probe against an admin member the command does not write
 * would be code that has never executed reporting a colour.
 *
 * **It held four and holds one** (T141/T142). A7, A8 and A9 were declared here
 * while the instance did not boot; A4 passing gave all three a subject, and
 * each is now a step above with a verdict from a measurement — including the
 * reds, which is the point. A12 is the one left, and what it waits on is a
 * published package rather than a step nobody has written.
 */
function declaredUnmeasured(): readonly AssertionResult[] {
  return [
    {
      id: 'A12' as const,
      state: 'unmeasured' as const,
      detail:
        'it needs a fixture registry to publish a platform patch into: T144, gated on F10 ' +
        '(`specs/071-modular-packaging/roadmap.md`)',
    },
  ];
}

/**
 * A5 and A13, over the tree the instance's own `build` script produced — or the
 * reason there is nothing to read.
 *
 * The two are computed together because they share one input and answer two
 * different questions about it: A5 that the screens are in the bundle, A13 that
 * they are visible. The admin member may legitimately not be there at all, and
 * that case is the omission the command printed, reported verbatim.
 */
function adminBundleAssertions(
  target: string,
  adminOmission: string | null,
): readonly AssertionResult[] {
  const adminDist = join(target, 'admin', 'dist');
  if (!existsSync(join(target, 'admin'))) {
    const reason =
      adminOmission ??
      'the created tree holds no `admin/` member and the command printed no omission for it';
    return [
      { id: 'A5', state: 'unmeasured', detail: reason },
      {
        id: 'A13',
        state: 'unmeasured',
        detail: `${reason} — there is no built stylesheet to read`,
      },
    ];
  }
  const modules = installedModules(target);
  const bundle = bundleEvidence(adminDist);
  return [
    evaluateA5({
      built: existsSync(adminDist),
      named: bundle.named,
      expected: modules.filter((module) => module.admin).map((module) => module.id),
      installed: modules.map((module) => module.id),
      bytes: bundle.bytes,
    }),
    evaluateA13(
      existsSync(adminDist)
        ? stylesheetWitnesses(target, adminDist)
        : ({ built: false, bytes: 0, packages: [] } satisfies AdminStylesheetObservation),
    ),
  ];
}

async function main(): Promise<void> {
  const againstExpectation = process.argv.includes('--against-expectation');
  const { mode, registry } = resolveMode();
  const dsn = process.env['ACCEPTANCE_DATABASE_URL'] ?? DEFAULT_DSN;
  const database = resolveDatabaseTarget(dsn);
  if ('error' in database) refuse(database.error);

  const temp = mkdtempSync(join(tmpdir(), 'endora-instance-acceptance-'));
  if (realpathSync(temp).startsWith(`${realpathSync(REPO_ROOT)}/`)) {
    refuse(
      `the temporary directory ${temp} is inside the checkout, so an install there would be ` +
        `reachable by relative specifier and by the workspace globs — the two things this ` +
        `criterion exists to leave behind`,
    );
  }
  const tarballDir = join(temp, 'artefact');
  const hostDir = join(temp, 'host');
  const target = join(temp, 'instance');
  mkdirSync(tarballDir, { recursive: true });

  const results: AssertionResult[] = [];
  try {
    const packed = mode === 'tarball' ? packEverything(tarballDir) : null;
    provisionHost(hostDir, packed, registry);
    // Before anything is invoked, because it decides what every line below is
    // *about*: in this mode the binary and the packages are the last publish's,
    // not this checkout's, and a report that does not say so is read as a
    // report on this tree.
    if (mode === 'registry') notes.push(describeRegistrySupply(suppliedPackages(hostDir)));
    const binary = assertInstalledBinaryContext(hostDir, temp);

    const scaffold = run(
      binary,
      [
        'new',
        'instance',
        target,
        ...(registry === null ? [] : ['--registry', registry]),
        '--non-interactive',
      ],
      { cwd: hostDir },
    );
    if (scaffold.code !== 0) {
      refuse(`\`endora new instance\` exited ${String(scaffold.code)}:\n${scaffold.output}`);
    }
    const omissionFor = (member: string): string | null =>
      scaffold.output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith(`omitted ${member}`)) ?? null;
    const adminOmission = omissionFor('admin/');
    const docsOmission = omissionFor('docs/');

    // A1 and A14 read the tree as the command wrote it — **before** the
    // pinning below, whose `file:` specifiers name a directory outside the
    // instance and are outward references by construction.
    const { outwardReferences } = (await import(
      pathToFileURL(join(hostDir, 'node_modules', SCOPE, 'cli', 'dist', 'index.js')).href
    )) as {
      outwardReferences: (reference: {
        repoRoot: string;
        dir: string;
        files: readonly string[];
        manifest: Record<string, unknown>;
      }) => readonly { file: string; specifier: string }[];
    };
    const treeFiles = listFiles(target, new Set(['node_modules', 'dist']));
    results.push(
      evaluateA1(
        outwardReferences({
          repoRoot: temp,
          dir: target,
          files: treeFiles,
          manifest: JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as Record<
            string,
            unknown
          >,
        }),
      ),
    );

    // A14 — the command's own classification, counted on disk.
    const wiringPaths = scaffold.output
      .split('\n')
      .map((line) => /^\s*wrote (\S+) — wiring$/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]!);
    results.push(
      evaluateA14({
        declared: wiringPaths.length,
        files: wiringPaths
          .filter((path) => existsSync(join(target, path)))
          .map((path) => ({
            path,
            lines: readFileSync(join(target, path), 'utf8').split('\n').length,
          })),
      }),
    );

    results.push(await measureRefusal(binary, hostDir, join(temp, 'refused')));

    const declared = declaredPackages(target);
    if (mode === 'tarball') {
      const closure = endoraClosure(declared, dependencyDeclarations(hostDir));
      pinClosure(target, packed!, closure);
    } else {
      assertRegistryNpmrc(target, declared);
    }
    // The harness's own line, belonging to neither mode: a peer range this
    // criterion is not the subject of must not stop the install.
    //
    // **`ignore-workspace=true` is deliberately not here**, and the storefront
    // criterion's `.npmrc` carries it for a reason that inverts one surface
    // over. A scaffolded storefront is not a workspace, so ignoring one is how
    // it refuses adoption by anything above the temporary directory. An
    // instance **is** a workspace — `pnpm-workspace.yaml` with one member is
    // `instance-tree.md` §2.1 — and since pnpm 10 a workspace root's
    // `overrides` live in that file, so ignoring the workspace ignores the
    // pinning: measured, every transitive `@endora-commerce/*` range went
    // straight to npmjs and A2 failed on a package nobody has published.
    // Adoption from above is refused by {@link assertInstalledBinaryContext}
    // instead, which is where R6.2a puts it.
    appendFileSync(join(target, '.npmrc'), 'strict-peer-dependencies=false\n');

    // Declared out here because A6 reads it: `build` reaches every member
    // (§2.5), so what the documentation site's build said is in this output and
    // the assertion that reports it sits outside the install block.
    let built: { code: number; output: string } | null = null;
    // Declared out here for the same reason: A7 reads the boot's three surfaces
    // and sits beside the bundle assertions rather than inside the boot block.
    let boot: BootObservation | null = null;
    let overlayEnvironment: NodeJS.ProcessEnv | null = null;
    const instanceVariables = declaredVariables(target);
    const installed = run('pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: target,
      env: insideInstance(instanceVariables, {}),
    });
    results.push(
      evaluateProcess(
        'A2',
        installed.code,
        installed.output,
        mode === 'tarball'
          ? `pnpm install succeeded outside the checkout, from packed tarballs`
          : `pnpm install succeeded outside the checkout, resolving published ranges from ${String(registry)}`,
      ),
    );

    if (installed.code === 0) {
      results.push(
        evaluateA11(digestTree(target, new Set(['node_modules', 'dist', '.env'])), shippedBy(target)),
      );

      await resetDatabase(database.adminUrl, database.databaseName);
      // The values a client supplies, put where a client puts them: **into the
      // instance's own `.env`**, the file `endora new instance` already wrote.
      //
      // They used to go into `process.env` instead, with a note saying the
      // instance's `.env.example` declared none of them — the acceptance
      // criterion reporting, in its own output, that step C3 of the install
      // could not be completed (`specs/123-oss-install-experience/` §1.3(a)).
      // G3 closed that, and the note is gone because an instrument that reports
      // a gap must not outlive it. What replaces it is a **refusal**: every name
      // below has to be one the instance's own `.env.example` declares, so a
      // value this criterion smuggles past a client's file is a red run rather
      // than a sentence at the bottom of a report.
      //
      // `SESSION_COOKIE_SECRET` is deliberately **not** here. The command
      // generated one into that same `.env` under R2.5d, and this run proving it
      // did — by starting an instance whose session key nobody supplied — is
      // FR-011's end-to-end evidence.
      const filledIn: Record<string, string> = {
        DATABASE_URL: database.databaseUrl,
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        PUBLIC_API_BASE_URL: 'https://instance.acceptance.invalid',
        NODE_ENV: 'production',
      };
      const undeclared = Object.keys(filledIn).filter(
        (name) => !instanceVariables.includes(name),
      );
      if (undeclared.length > 0) {
        refuse(
          `this run would supply ${undeclared.join(', ')} to the instance's own processes, ` +
            `and its \`.env.example\` declares none of them — so a client who filled in the ` +
            `file the command wrote would have nothing to put them in, and every assertion ` +
            `after this one would be measuring a tree this criterion configured by hand. ` +
            `\`specs/123-oss-install-experience/\` G3 is what closed that; a name reappearing ` +
            `here is that gap reopening.`,
        );
      }
      fillInInstanceEnv(target, filledIn);
      // Nothing is handed to the instance's processes: every declared name is
      // withheld, and what the instance reads it reads from the file a client
      // would have edited. That is the whole claim G3 makes.
      const environment = insideInstance(instanceVariables, {});

      built = run('pnpm', ['run', 'build'], { cwd: target, env: environment });
      // **The gate is the backend member's own artefact, not the root script's
      // exit code**, and the difference arrived with the documentation member.
      // `build` reaches every member (§2.5), so one member failing used to take
      // A3 and A4 with it — a false signal about the migrator, which may be
      // sitting right there compiled. It is not a weakening: a root script that
      // is a silent no-op produces no `dist/migrate.js` either, which is the
      // defect T141 found and this gate still catches, with the build's own
      // output beside it.
      const backendBuilt = existsSync(join(target, 'backend', 'dist', 'migrate.js'));
      const migrated = backendBuilt
        ? run('pnpm', ['run', 'migrate'], { cwd: target, env: environment })
        : null;
      results.push(
        evaluateA3({
          migrateCode: migrated === null ? null : migrated.code,
          migrateOutput:
            migrated === null
              ? `the instance's own \`build\` script exited ${String(built?.code ?? -1)} and left no ` +
                `\`backend/dist/migrate.js\`, so there is no migrator to run: ${built?.output ?? ''}`
              : migrated.output,
          computedOrder:
            migrated?.code === 0
              ? computedMigrationOrder(join(target, 'backend'), {
                  ...process.env,
                  ...environment,
                })
              : null,
          applied: migrated?.code === 0 ? await appliedMigrations(database.databaseUrl) : null,
        }),
      );
      if (built.code !== 0) {
        // `build` reaches every member (§2.5), so **which** member failed is
        // the question this note answers. It said "so A3 reports it rather than
        // a migration" while A3's gate was this exit code; the gate is now the
        // backend member's own `dist/migrate.js`, so a documentation or admin
        // failure no longer takes A3 with it — and a reader of the report has
        // to be told that the run they are looking at had a broken member.
        notes.push(
          `the instance's own \`build\` script exited ${String(built.code)}; it reaches every ` +
            `member, and the assertion for each member reports its own half: ` +
            failureExcerpt(built.output, 3),
        );
      }

      if (migrated?.code === 0) {
        // The step between `migrate` and `start` that the command's own next
        // steps and the README both name (`specs/110-instance-repository/`
        // T141). An instance's modules are installed packages, and a package's
        // `module_registrations` row is written by `module:install` and by no
        // boot (D-157.6(b)) — so without this the boot refuses with
        // `RequiredModuleAbsentError` over every locked module the instance
        // ships. It is run here for this file's own stated reason: reaching
        // past the instance's scripts into a sequence nobody is told about
        // would be measuring something else, and the sequence a client is told
        // about has five steps rather than four.
        const installed = run('pnpm', ['run', 'module:install', '--all'], {
          cwd: target,
          env: environment,
        });
        if (installed.code !== 0) {
          notes.push(
            `the instance's own \`module:install --all\` exited ${String(installed.code)}, so ` +
              `A4 reports whatever the boot then does rather than a clean start: ` +
              failureExcerpt(installed.output, 3),
          );
        }
        // A15's first half (`specs/123-oss-install-experience/` G2). It runs
        // the instance's **own** root script, exactly as `migrate` and
        // `module:install` above do: a criterion that reached past the scripts
        // into `node dist/cli.js` would report green over a manifest whose
        // scripts do not work, which is T141's own finding one step over.
        //
        // `null` distinguishes "the script does not exist" — the whole of the
        // G2 defect — from "it ran and failed", and pnpm answers the first with
        // exit 1 and a message naming the script, so the two are read apart
        // from the manifest rather than from the exit code.
        const hasAdminCreate = Object.hasOwn(
          (JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
            scripts?: Record<string, string>;
          }).scripts ?? {},
          'admin:create',
        );
        const created = hasAdminCreate
          ? run(
              'pnpm',
              [
                'run',
                'admin:create',
                '--',
                `--email=${ADMIN_EMAIL}`,
                `--password=${ADMIN_PASSWORD}`,
                '--first-name=Acceptance',
                '--last-name=Run',
              ],
              { cwd: target, env: environment },
            )
          : null;
        const administrator: AdministratorObservation = {
          createCode: created === null ? null : created.code,
          createOutput:
            created === null
              ? "the instance's root manifest declares no `admin:create` script"
              : created.output,
          loginStatus: null,
          sessionCookie: false,
          loginBody: '',
        };
        // The boot is attempted whenever the migrate step claimed to succeed,
        // including when A3 then reported that nothing was migrated: what the
        // start script does is a separate question from what the migrate script
        // did, and a criterion that skipped it would report one defect and stop
        // where there are two.
        //
        // **One boot answers four assertions**, and that is not economy: A7's
        // whole subject is that the composition serving the API is the one
        // enumerating the modules and the one behind the bundle, so a second
        // boot would be a second composition, and A15's login says the same of
        // itself.
        boot = await bootOnce(target, environment, created?.code === 0);
        results.push(
          evaluateA4({
            started: true,
            healthStatus: boot.healthStatus,
            reconcile: reconcileFigures(boot.output),
            enumerated: boot.enumerated === null ? null : boot.enumerated.length,
            output: boot.output,
          }),
        );
        results.push(
          evaluateA15({
            ...administrator,
            loginStatus: boot.loginStatus,
            sessionCookie: boot.sessionCookie,
            loginBody: boot.loginBody,
          }),
        );

        // A9 needs the migrated schema and the installed platform, and no
        // server: it reads the guard in a process of its own, inside the
        // instance.
        results.push(evaluateA9(measureTenancy(target, environment)));

        // A8's fixture and its second boot, after A4 and A15 have answered over
        // the tree the command wrote. See `measureOverlay`.
        const deployment = deploymentsIn(target)[0];
        if (deployment === undefined) {
          results.push({
            id: 'A8',
            state: 'unmeasured',
            detail:
              'the created tree holds no directory under `apps/`, so this instance has no ' +
              'deployment to write an overlay module into (`contracts/instance-tree.md` §2.2)',
          });
        } else {
          overlayEnvironment = { ...environment, DEPLOYMENT: deployment };
          notes.push(
            `supplied DEPLOYMENT=${deployment} for A8's steps; the instance's own ` +
              '`.env.example` declares it and leaves it blank, and blank is bare core — no ' +
              'overlay module is composed at all',
          );
          results.push(evaluateA8(await measureOverlay(target, deployment, overlayEnvironment)));
        }
      } else {
        results.push(
          evaluateA4({
            started: false,
            healthStatus: null,
            reconcile: null,
            enumerated: null,
            output: '',
          }),
        );
        results.push({
          id: 'A8',
          state: 'unmeasured',
          detail: 'the instance did not migrate, so there is nothing to compose an overlay in',
        });
        results.push({
          id: 'A9',
          state: 'unmeasured',
          detail: 'there is no migrated schema to read across tenants in',
        });
        results.push({
          id: 'A15',
          state: 'unmeasured',
          detail: 'the instance did not migrate, so there is no schema to create an administrator in',
        });
      }
    } else {
      results.push({
        id: 'A11',
        state: 'unmeasured',
        detail: 'there is no install to read the platform and shell packages out of',
      });
      results.push({ id: 'A3', state: 'unmeasured', detail: 'there is no install to migrate' });
      results.push({ id: 'A4', state: 'unmeasured', detail: 'there is no install to boot' });
      results.push({
        id: 'A8',
        state: 'unmeasured',
        detail: 'there is no install to compose an overlay module in',
      });
      results.push({
        id: 'A9',
        state: 'unmeasured',
        detail: 'there is no install to read the tenant guard out of',
      });
      results.push({
        id: 'A15',
        state: 'unmeasured',
        detail: 'there is no install to create an administrator in',
      });
    }

    const bundle = adminBundleAssertions(target, adminOmission);
    results.push(...bundle);

    // A7 — the three surfaces together, over the population this run packed and
    // the instance did not install.
    const installedIds = installedModules(target).map((module) => module.id);
    const { absent, routes } = absentModules(target, installedIds);
    results.push(
      evaluateA7({
        absent,
        installed: installedIds,
        bundleNames:
          bundle.find((result) => result.id === 'A5')?.state === 'unmeasured'
            ? null
            : bundleEvidence(join(target, 'admin', 'dist')).named,
        servedRoutes: boot?.servedRoutes ?? null,
        absentRoutes: routes,
        enumerated: boot?.enumerated ?? null,
        enumerationExemptions: await platformOwnModuleIds(
          target,
          // The deployment's own overlay modules are entitled to be enumerated
          // and are not installed packages — A8 wrote one of them.
          overlayEnvironment === null ? [] : [OVERLAY_MODULE_ID],
        ),
      }),
    );

    results.push(
      evaluateA6(
        existsSync(join(target, 'docs'))
          ? docsSiteObservation(target, built)
          : {
              present: false,
              omission: docsOmission,
              built: false,
              buildOutput: '',
              expected: [],
              named: [],
              routed: [],
              pages: 0,
            },
      ),
    );
    results.push(...declaredUnmeasured());
  } finally {
    await dropDatabase(database.adminUrl, database.databaseName);
    if (process.env['KEEP_INSTANCE_ACCEPTANCE'] !== '1') {
      rmSync(temp, { recursive: true, force: true });
    } else notes.push(`kept ${temp}`);
  }

  const complete = completeResults(results);
  console.log(formatReport(complete, notes, mode));

  if (!againstExpectation) process.exit(exitCodeFor(complete));
  if (!existsSync(EXPECTATION_FILE)) refuse(`${EXPECTATION_FILE} is not there`);
  const expectation = JSON.parse(readFileSync(EXPECTATION_FILE, 'utf8')) as AcceptanceExpectation;
  const refusals = expectationRefusals(expectation);
  if (refusals.length > 0) {
    refuse(
      `${EXPECTATION_FILE} cannot be compared against:\n  ${refusals.join('\n  ')}\n` +
        `T140's own done-when is that every unmet assertion names the contract or task it ` +
        `waits on, never "unimplemented".`,
    );
  }
  const drift = compareToExpectation(complete, expectation, mode);
  for (const line of drift) console.error(`[instance-acceptance] drift: ${line}`);
  if (drift.length === 0) {
    console.log('[instance-acceptance] the run agrees with the recorded expectation.');
  } else {
    console.error(
      `[instance-acceptance] update ${EXPECTATION_FILE} in the merge request that moved this, ` +
        `with what changed and why.`,
    );
  }
  process.exit(exitCodeForExpectation(drift));
}

/**
 * What the platform and the admin shell ship, out of the instance's own
 * `node_modules` — A11's other half.
 *
 * Read from the install rather than from this checkout's `packages/`, because
 * the assertion is about what *those packages ship*: a file in `src/` that no
 * `files` entry publishes is not something a client's instance could hold a
 * copy of.
 */
function shippedBy(target: string): readonly ShippedFiles[] {
  const shipped: ShippedFiles[] = [];
  // The root's `node_modules` **and** each member's: pnpm installs a package
  // where it is declared, and since T138 the shell is the admin member's
  // dependency rather than the root's. Reading the root alone reported
  // `admin-shell does not resolve` over a tree that had it, which is A11's own
  // `unmeasured` verdict arriving from the criterion's blind spot rather than
  // from the tree.
  const roots = [target, ...workspaceMemberDirectories(target)];
  for (const name of ['platform', 'admin-shell']) {
    const dir =
      roots
        .map((root) => join(root, 'node_modules', SCOPE, name))
        .find((candidate) => existsSync(candidate)) ?? join(target, 'node_modules', SCOPE, name);
    // An absent package is recorded as unresolved rather than skipped: R6.3's
    // A11 is a claim about **both**, and a comparison against a package that is
    // not there is vacuously clean — which is the silence the judgement reports
    // as `unmeasured` instead of folding into the other half's green.
    shipped.push({
      packageName: `${SCOPE}/${name}`,
      resolved: existsSync(dir),
      files: existsSync(dir) ? digestTree(realpathSync(dir), new Set(['node_modules'])) : [],
    });
  }
  return shipped;
}

await main();
