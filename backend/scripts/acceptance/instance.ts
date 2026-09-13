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
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { normalizeRegistry } from '@endora-commerce/cli';

import { resolveDatabaseTarget } from './assertions.js';
import {
  compareToExpectation,
  completeResults,
  endoraClosure,
  evaluateA1,
  evaluateA3,
  evaluateA4,
  evaluateA10,
  evaluateA11,
  evaluateA13,
  evaluateA5,
  evaluateA6,
  type AdminStylesheetObservation,
  type DocsSiteObservation,
  evaluateA14,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
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
} from './instance-assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const EXPECTATION_FILE = join(BACKEND_ROOT, 'acceptance', 'instance-expected-state.json');
const DEFAULT_DSN = 'postgresql://b2b:b2b@localhost:5432/b2b_instance_acceptance_test';
const HEALTH_PATH = '/api/v1/_health';
const PRESENCE_PATH = '/api/v1/storefront/module-presence';
const SCOPE = '@endora-commerce';

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
  const result = run(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: backendDir,
    env: environment,
  });
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

/** A4 — one boot of the created instance, through its own `start` script. */
async function bootOnce(
  target: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ healthStatus: number | null; enumerated: number | null; output: string }> {
  const port = 3400 + Math.floor(Math.random() * 300);
  const child = spawn('pnpm', ['run', 'start'], {
    cwd: target,
    env: { ...process.env, ...environment, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (child.exitCode !== null) return { healthStatus: null, enumerated: null, output };
      if (Date.now() > deadline) return { healthStatus: null, enumerated: null, output };
      await new Promise((wait) => setTimeout(wait, 2_000));
      let healthStatus: number;
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}${HEALTH_PATH}`, {
          signal: AbortSignal.timeout(10_000),
        });
        healthStatus = response.status;
      } catch {
        continue;
      }
      let enumerated: number | null = null;
      try {
        const presence = await fetch(`http://127.0.0.1:${String(port)}${PRESENCE_PATH}`, {
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await presence.json()) as { modules?: readonly unknown[] };
        enumerated = Array.isArray(body.modules) ? body.modules.length : null;
      } catch {
        enumerated = null;
      }
      return { healthStatus, enumerated, output };
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
 * The assertions this criterion cannot measure today, each with the contract or
 * task that retires it.
 *
 * They are **declared** rather than attempted, and the difference matters: a
 * step that ran and found nothing is a measurement, and these have no subject
 * at all. Writing a probe against an admin member the command does not write
 * would be code that has never executed reporting a colour.
 */
function declaredUnmeasured(): readonly AssertionResult[] {
  return [
    {
      id: 'A7' as const,
      state: 'unmeasured' as const,
      detail:
        'two of its three halves are the API surface and the module enumeration, and both are ' +
        'A4\'s — the instance does not boot. The third, the built admin bundle, now has a ' +
        'subject and is asserted in one direction by A5 (a module named and not installed is ' +
        'A5\'s `extra`); a verdict here over that half alone would be answering a third of ' +
        'the assertion',
    },
    {
      id: 'A8' as const,
      state: 'unmeasured' as const,
      detail:
        'A8 is two halves — an overlay module in the created tree is **composed**, and its ' +
        'decoration **appears in the divergence report** — and neither is measured here yet. ' +
        'This reason previously said the report half had no implementation anywhere: *"the ' +
        'divergence report is not in `instance-tree.md` §2.6 and no instance generates one, ' +
        'because its renderer is `backend/scripts/`"*. **That premise expired with T138a**, ' +
        'which moved the derivation and the two renders into `@endora-commerce/cli` and gave ' +
        '`endora generate` a fourth artefact family: an instance now renders ' +
        '`apps/<deployment>/divergence.generated.{md,json}` over its own `apps/` tree, and ' +
        '§2.6 carries the row. What stands between that and a verdict here is **this ' +
        'criterion**, not the platform: the tree it creates has an empty ' +
        '`apps/<deployment>/modules/`, so there is no overlay module to compose and no ' +
        'decoration to look for. Writing one into the created tree and asserting over the ' +
        'rendered report is this assertion\'s own step (T141/T142); the composed half stays ' +
        'A4\'s. Recorded as `unmeasured` because that is what it is — T138a measured that an ' +
        'instance generates the report, over a real on-disk install in ' +
        '`packages/cli/test/divergence.test.ts`, and measured nothing here',
    },
    {
      id: 'A9' as const,
      state: 'unmeasured' as const,
      detail: 'it needs a booted instance with a migrated schema to read across tenants in (A4)',
    },
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
      // The runtime values an instance needs and its own `.env.example` does
      // not declare. Supplied explicitly and named here rather than quietly:
      // a client who fills in the file the command wrote has none of them.
      const runtime: Record<string, string> = {
        DATABASE_URL: database.databaseUrl,
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        SESSION_COOKIE_SECRET: 'instance-acceptance-secret-not-a-real-deployment',
        PUBLIC_API_BASE_URL: 'https://instance.acceptance.invalid',
        NODE_ENV: 'production',
      };
      const undeclared = Object.keys(runtime).filter((name) => !instanceVariables.includes(name));
      if (undeclared.length > 0) {
        notes.push(
          `supplied ${undeclared.join(', ')} to the instance's own processes; its ` +
            `\`.env.example\` declares none of them, so a client who fills in the file the ` +
            `command wrote has nothing to put them in`,
        );
      }
      const environment = insideInstance(instanceVariables, runtime);

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
            `${built.output.trim().split('\n').slice(-3).join(' / ')}`,
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
              `${installed.output.trim().split('\n').slice(-3).join(' / ')}`,
          );
        }
        // The boot is attempted whenever the migrate step claimed to succeed,
        // including when A3 then reported that nothing was migrated: what the
        // start script does is a separate question from what the migrate script
        // did, and a criterion that skipped it would report one defect and stop
        // where there are two.
        const boot = await bootOnce(target, environment);
        results.push(
          evaluateA4({
            started: true,
            healthStatus: boot.healthStatus,
            reconcile: reconcileFigures(boot.output),
            enumerated: boot.enumerated,
            output: boot.output,
          }),
        );
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
      }
    } else {
      results.push({
        id: 'A11',
        state: 'unmeasured',
        detail: 'there is no install to read the platform and shell packages out of',
      });
      results.push({ id: 'A3', state: 'unmeasured', detail: 'there is no install to migrate' });
      results.push({ id: 'A4', state: 'unmeasured', detail: 'there is no install to boot' });
    }

    results.push(...adminBundleAssertions(target, adminOmission));
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
