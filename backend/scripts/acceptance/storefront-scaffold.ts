/**
 * The acceptance criterion for `endora new storefront` (feature F7,
 * `specs/071-modular-packaging/roadmap.md` § *F7 — Storefront scaffold*).
 *
 * ## What it does, and why it is not a test in `backend/test/`
 *
 * It scaffolds a storefront **outside this repository**, installs it with no
 * symlink back, builds it with `next build`, and boots the result. Every step
 * exists to leave the monorepo, for `acceptance:package-schema`'s
 * reason one surface over: a copy that stays inside is still inside relative-
 * specifier range, still reached by the workspace globs, and pnpm links a
 * workspace member into `node_modules` — so a rehearsal that stays inside passes
 * and proves nothing.
 *
 * ## Two supply routes, and the tarball one is the default
 *
 * **`tarball`** packs each package the scaffold declares and pins it through
 * `pnpm.overrides`, which is publication's stand-in and reaches the transitive
 * edges too — `@endora-commerce/page-builder-core` depends on `contracts`, and
 * `pnpm pack` correctly rewrites that `workspace:*` to a version that is equally
 * unpublished. It is the default, and it stays the default for two reasons that
 * are not the same one: it is the only mode that works **before** the first
 * publish, and it is what keeps the criterion green on a branch that publishes
 * nothing.
 *
 * **`registry`** (feature 104, § 1.6) skips the packing entirely and installs
 * the semver ranges the scaffold wrote, from a real registry, through the
 * `.npmrc` `endora new storefront --registry` emits. That is the rehearsal being
 * rehearsed rather than a publish nobody installs from: it is the only mode in
 * which the three ranges, the `.npmrc`, the token expansion and the published
 * tarballs are all exercised at once.
 *
 * The mode is chosen by the environment — `ENDORA_NPM_REGISTRY` — and never by a
 * flag, so the CI job that has the variables takes the second route and every
 * other run takes the first. The six assertions are identical under both; only
 * the install differs, which is what makes the two one criterion rather than
 * two.
 *
 * ## It supplies the inputs the command requires, and derives which those are
 *
 * `specs/117-instance-bring-up/` removed the storefront's invented defaults and
 * gave `endora new storefront` a four-tier resolution ending in a refusal. This
 * criterion had been invoking it with no inputs at all, which worked only while
 * the defaults existed — so from the moment they went, the command refused, the
 * run exited **2**, and all six assertions were unrun. That is the state this
 * file exists to refuse, arriving in the file itself.
 *
 * It supplies them as **flags** — tier 1 — and the reason is in
 * {@link resolveScaffoldInputs}: the copy's `.env` is what the command now
 * writes and what `next build` and `next start` read, so a harness that placed
 * that file instead would be supplying an artefact whose production is part of
 * what it measures. Which inputs and which values are derived, from the
 * storefront's own declaration and its own `.env.example`; a required input no
 * derivation reaches is a refusal rather than a value this run makes up.
 *
 * ## And it withholds its own environment from the instance
 *
 * The install, the build and the boot are processes of the **instance**, so they
 * are given the instance's environment rather than this harness's: every name
 * the copy's own declaration says its process reads is withheld unless this run
 * deliberately supplies it ({@link instanceEnvironment}, and `insideInstance`
 * below is the one place that hands it `process.env`).
 *
 * It is the difference between measuring the command and measuring whoever ran
 * this file. Next loads the copy's `.env` and does **not** override a variable
 * the process already carries, so an inherited one silently configures the
 * instance over the top of what `endora new storefront` wrote — a red for a
 * value no client would set, or a green for a value the command never produced.
 * Measured: `NODE_ENV=development`, which `acceptance:storefront-scaffold` sets
 * job-wide and correctly for the **backend** it boots, made A5 fail in every CI
 * run this criterion has ever had, with a message naming Next's own
 * `pages/_document`.
 *
 * ## Exit codes
 *
 *   0 — the criterion is met.
 *   1 — it is red: something was measured and failed.
 *   2 — it could not be measured. Never a green, never a red.
 *
 * With `--against-expectation` the run is compared to
 * `backend/acceptance/storefront-scaffold-expected-state.json` and drift fails in
 * **either** direction, which is `acceptance:package-schema`'s arrangement and
 * for its reason: a newly-red assertion fails, and so does a newly-green one
 * nobody recorded.
 *
 * Usage: `pnpm --filter backend run acceptance:storefront-scaffold`.
 */

/* eslint-disable no-console -- CLI: stdout is the interface. */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRequiredGiven, type EnvironmentInput } from '@endora-commerce/contracts';

import {
  canonicalHrefIn,
  compareToExpectation,
  COMPILED_IN_SITE_ORIGIN,
  evaluateA1,
  evaluateA2,
  evaluateA4,
  evaluateA6,
  evaluateA7,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  formatReport,
  instanceEnvironment,
  planScaffoldInputs,
  SCAFFOLD_INPUT_STAND_INS,
  type AcceptanceExpectation,
  type AcceptanceMode,
  type AssertionResult,
} from './storefront-scaffold-assertions.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const EXPECTATION_FILE = join(
  BACKEND_ROOT,
  'acceptance',
  'storefront-scaffold-expected-state.json',
);

const notes: string[] = [];

/**
 * Every variable the instance's own declaration says its process reads.
 *
 * Read off the **copy**, once, as soon as there is a copy to read — the same
 * `environment-inputs.mjs` `endora new storefront` resolved against, so the
 * criterion and the command cannot come to disagree about what an instance
 * reads. It is empty until then, which is correct: before the scaffold there is
 * no instance and nothing to withhold from.
 */
let instanceDeclaredVariables: readonly string[] = [];

/**
 * The environment for a process run **inside the instance**.
 *
 * {@link instanceEnvironment} is the judgement and is unit tested; this is the
 * one place that hands it the harness's real environment. The return value is an
 * overlay rather than a whole environment, because `run` and `spawn` already
 * merge over `process.env` and a withheld name is expressed as `undefined`,
 * which `child_process` drops.
 */
function insideInstance(supplied: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return instanceEnvironment({
    ambient: process.env,
    declared: instanceDeclaredVariables,
    supplied,
  }).overlay;
}

function refuse(message: string): never {
  console.error(`[storefront-acceptance] cannot measure: ${message}`);
  console.error('[storefront-acceptance] exit 2 — neither a pass nor a failure of the criterion.');
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
 * mode and not an anonymous attempt. Measured in feature 104's `research.md` §6:
 * a GitLab npm endpoint answers a missing or invalid credential with **404**,
 * and pnpm reports it as *"is not in the npm registry, or you have no permission
 * to fetch it"* — the same sentence it gives for a package that was never
 * published. So an unauthenticated registry run would produce a red A3 whose
 * cause is indistinguishable from the criterion's own subject failing, which is
 * exactly the state exit 2 exists for.
 */
function resolveMode(): { mode: AcceptanceMode; registry: string | null } {
  const registry = (process.env['ENDORA_NPM_REGISTRY'] ?? '').trim();
  if (registry.length === 0) return { mode: 'tarball', registry: null };
  if ((process.env['ENDORA_NPM_TOKEN'] ?? '').trim().length === 0) {
    refuse(
      `ENDORA_NPM_REGISTRY names ${registry} and ENDORA_NPM_TOKEN is unset. The registry ` +
        `answers an absent credential with 404 and pnpm reports it as "is not in the npm ` +
        `registry", which is byte-identical to the packages never having been published — so ` +
        `this run would produce a red A3 that says nothing about the criterion. Set the token, ` +
        `or unset the registry to measure the tarball mode.`,
    );
  }
  return { mode: 'registry', registry };
}

/**
 * The inputs this run puts on the command line — tier 1 of the four
 * (`specs/117-instance-bring-up/contracts/input-resolution.md` §1).
 *
 * **Tier 1 rather than tier 2, and the choice is about who authors the
 * instance's `.env`.** The other route is to place that file in the target
 * directory before the command runs, which the command supports and whose
 * single-`.env` exception to its empty-directory rule exists for. It is the
 * wrong route *here*: `.env` is what the command now writes, and `next build`
 * and `next start` read it, so a harness that placed it would be supplying an
 * artefact whose production is part of what it is measuring — A5 and A6 would
 * stay green over a command that wrote nothing at all. A flag cannot do that: it
 * reaches the instance only by the command having resolved it and written it
 * down. Tier 2 is not thereby unexercised — `packages/cli/test/non-interactive-
 * guarantee.test.ts` spawns the built command against a pre-placed `.env` and
 * asserts `env-file=5` and that the operator's own comment survived the merge.
 *
 * Which inputs, and which value each gets, is {@link planScaffoldInputs}': the
 * population is the storefront's own declaration and the values are the copy's
 * own `.env.example`, so nothing here is a list of variable names. The flag
 * spelling is `flagFor`'s, the command's own derivation, for the same reason.
 */
async function resolveScaffoldInputs(): Promise<readonly string[]> {
  const {
    backendAddressVariablesOf,
    storefrontAddressVariablesOf,
    envExampleDeclarationsOf,
    flagFor,
    resolveReference,
    storefrontDeclaredInputs,
  } = (await import('@endora-commerce/cli')) as {
    backendAddressVariablesOf: (storefrontDir: string) => Promise<readonly string[]>;
    storefrontAddressVariablesOf: (storefrontDir: string) => Promise<readonly string[]>;
    envExampleDeclarationsOf: (storefrontDir: string) => ReadonlyMap<string, string>;
    flagFor: (name: string) => string;
    resolveReference: (cwd: string) => { dir: string };
    storefrontDeclaredInputs: (cwd: string) => Promise<readonly EnvironmentInput[]>;
  };

  // The **reference** storefront's, not the copy's: the copy does not exist yet,
  // and these values are what brings it into existence. Everything downstream of
  // the scaffold reads the copy's own file instead, which is the same bytes and
  // the honest source once there is one.
  const referenceDir = resolveReference(REPO_ROOT).dir;
  const declared = await storefrontDeclaredInputs(REPO_ROOT);
  if (declared.length === 0) {
    refuse(
      `${referenceDir} declares no environment input scoped to the storefront, so this run ` +
        `cannot know what the command will demand of it`,
    );
  }
  const required = declared
    .filter((input) => isRequiredGiven(input, {}))
    .map((input) => input.name);
  const backend = process.env['PUBLIC_API_BASE_URL'] ?? null;
  const plan = planScaffoldInputs({
    required,
    backendAddressVariables: await backendAddressVariablesOf(referenceDir),
    storefrontAddressVariables: await storefrontAddressVariablesOf(referenceDir),
    backend,
    storefront: SITE_ORIGIN_UNDER_TEST,
    envExample: envExampleDeclarationsOf(referenceDir),
    standIns: SCAFFOLD_INPUT_STAND_INS,
  });

  if (plan.unanswerable.length > 0) {
    refuse(
      `the storefront declares ${plan.unanswerable.join(', ')} required and nothing in this ` +
        `checkout supplies a value: it is not a backend address, ` +
        `${join(referenceDir, '.env.example')} does not declare it, and it is not in the ` +
        `stand-in table. \`endora new storefront\` would refuse this invocation, so every ` +
        `assertion below would be unrun — which is what happened when feature 117 removed the ` +
        `storefront's invented defaults. Declare it in that file, or add a stand-in with the ` +
        `reason and the condition that retires it.`,
    );
  }
  if (plan.staleStandIns.length > 0) {
    refuse(
      `SCAFFOLD_INPUT_STAND_INS holds ${plan.staleStandIns.join(', ')}, which the tree now ` +
        `answers for itself or no longer declares required. A stand-in that outlives its reason ` +
        `is a value this run invents while reporting that it derived one — delete the entry.`,
    );
  }

  // Names, never values: one of these is declared `secret` and the criterion has
  // no business printing it, even when the value is a placeholder committed in
  // this repository.
  notes.push(
    `supplied ${String(plan.values.size)} required input${plan.values.size === 1 ? '' : 's'} ` +
      `on the command line — ${[...plan.values.keys()].join(', ')} — the population is ` +
      `\`storefront/environment-inputs.mjs\`'s and the values are ` +
      `\`storefront/.env.example\`'s, with the backend addresses pointed at ` +
      `${backend ?? 'the copy\'s own example address, this run having booted no backend'} ` +
      `and the storefront's own public address at ${SITE_ORIGIN_UNDER_TEST}`,
  );

  return [...plan.values].flatMap(([name, value]) => [flagFor(name), value]);
}

/** The `endora` entry point, run from source so the criterion measures this branch. */
function scaffold(target: string, registry: string | null, inputs: readonly string[]): void {
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) refuse(`${tsx} is missing — run \`pnpm install\` first`);
  const entry = join(REPO_ROOT, 'packages', 'cli', 'src', 'bin', 'endora.ts');
  if (!existsSync(entry)) refuse(`${entry} is not there, so there is no command to measure`);
  const result = run(
    tsx,
    [
      entry,
      'new',
      'storefront',
      target,
      ...(registry === null ? [] : ['--registry', registry]),
      // Explicit, though `spawnSync` gives the child pipes on both descriptors
      // and the command would refuse to prompt anyway: the guarantee this run
      // depends on is *"it never blocks on a question"*, and depending on it by
      // accident of how the harness spawns is depending on it by accident.
      '--non-interactive',
      ...inputs,
    ],
    { cwd: REPO_ROOT },
  );
  if (result.code !== 0) {
    refuse(`\`endora new storefront\` exited ${String(result.code)}:\n${result.output}`);
  }
  // The command's own account of where each value came from (R2.1). Recorded
  // rather than asserted — its `defaulted=0` is `packages/cli`'s own subject —
  // but recorded, because a report that did not carry it would leave a reader of
  // this run unable to tell a scaffold configured by five flags from one
  // configured by a `.env` somebody left behind.
  const provenance = result.output
    .split('\n')
    .find((line) => line.startsWith('[inputs] resolved:'));
  notes.push(
    registry === null
      ? `scaffolded into ${target}`
      : `scaffolded into ${target} with --registry ${registry}`,
  );
  if (provenance === undefined) {
    refuse(
      `\`endora new storefront\` printed no \`[inputs] resolved:\` line, so this run cannot ` +
        `say where the instance's configuration came from`,
    );
  }
  notes.push(`the command reported ${provenance}`);
}

/**
 * The `@endora-commerce/*` packages the scaffold declares.
 *
 * Read off the **scaffold's own manifest**, never a list here: the command
 * derives what it rewrites from the reference storefront, so a criterion
 * carrying its own list would answer a different question from the one the
 * command asked. Both modes need this set — one to pack it, the other to check
 * where it resolved — so it is derived once.
 */
function declaredPackages(target: string): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ].filter((name) => name.startsWith('@endora-commerce/'));
  if (declared.length === 0) {
    refuse(
      'the scaffold declares no @endora-commerce/* package, so there is nothing to install and ' +
        'the run would prove nothing about publication',
    );
  }
  return declared;
}

/**
 * Pack every `@endora-commerce/*` package the scaffold declares, and pin it.
 *
 * The `tarball` mode's whole difference from the `registry` one, and it is
 * skipped rather than adapted when a registry is configured: an override is a
 * *replacement* for the semver range the scaffold wrote, so a registry run that
 * kept one would resolve a file and report that a published version resolved.
 */
function packAndPin(
  target: string,
  tarballDir: string,
  declared: readonly string[],
): readonly string[] {
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };

  const overrides: Record<string, string> = {};
  for (const name of declared) {
    const dir = join(REPO_ROOT, 'packages', name.slice('@endora-commerce/'.length));
    if (!existsSync(join(dir, 'package.json'))) {
      refuse(`${name} is declared by the scaffold and is not a package of this checkout`);
    }
    if (!existsSync(join(dir, 'dist'))) {
      refuse(`${dir} has no dist — run \`pnpm run build:packages\` first`);
    }
    const before = new Set(readdirSync(tarballDir));
    const packed = run('pnpm', ['pack', '--pack-destination', tarballDir], { cwd: dir });
    if (packed.code !== 0) refuse(`\`pnpm pack\` failed for ${name}:\n${packed.output}`);
    const written = readdirSync(tarballDir).filter(
      (entry) => entry.endsWith('.tgz') && !before.has(entry),
    );
    if (written.length !== 1) {
      refuse(`\`pnpm pack\` in ${dir} wrote ${String(written.length)} tarballs, expected one`);
    }
    overrides[name] = `file:${join(tarballDir, written[0]!)}`;
  }

  // Publication's stand-in, and the whole of it. `pnpm pack` rewrites a
  // `workspace:` range in a packed manifest to a version, so
  // page-builder-core's dependency on contracts arrives as `0.0.0` — correct,
  // and unresolvable until a registry serves it. An override reaches that edge;
  // a dependency entry in the instance would not.
  manifest.pnpm = { ...manifest.pnpm, overrides };
  for (const [name, spec] of Object.entries(overrides)) {
    if (manifest.dependencies?.[name] !== undefined) manifest.dependencies[name] = spec;
    if (manifest.devDependencies?.[name] !== undefined) manifest.devDependencies[name] = spec;
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  notes.push(
    `packed and pinned ${declared.join(', ')} — publication removes the overrides block and ` +
      `nothing else`,
  );
  return declared;
}

/**
 * The registry mode's precondition, checked before the install rather than
 * inferred from it.
 *
 * The mode's claim is *"the ranges the scaffold wrote resolved from the registry
 * the scaffold was told about"*, and two things would make an install satisfy
 * every assertion while proving something else: an `.npmrc` the command did not
 * write (so the fetches go to the default registry) and an overrides block (so a
 * file resolves and the range is never asked for). Neither is a red criterion —
 * both are a run that cannot measure what it says it measures, which is exit 2.
 */
function assertRegistryNpmrc(target: string, declared: readonly string[]): void {
  const path = join(target, '.npmrc');
  if (!existsSync(path)) {
    refuse(
      `\`endora new storefront --registry\` wrote no ${path}. Without it every fetch goes to ` +
        `the default registry, so this run would report on npmjs while claiming to measure the ` +
        `configured one.`,
    );
  }
  const text = readFileSync(path, 'utf8');
  const scopes = [...new Set(declared.map((name) => name.slice(0, name.indexOf('/'))))].sort();
  const unconfigured = scopes.filter((scope) => !text.includes(`${scope}:registry=`));
  if (unconfigured.length > 0) {
    refuse(
      `${path} names no registry for ${unconfigured.join(', ')}, and the scaffold declares ` +
        `${declared.length} package${declared.length === 1 ? '' : 's'} in ` +
        `${unconfigured.length === 1 ? 'that scope' : 'those scopes'}. Those fetches would go ` +
        `to the default registry.`,
    );
  }
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
    pnpm?: { overrides?: Record<string, string> };
  };
  const overridden = Object.keys(manifest.pnpm?.overrides ?? {});
  if (overridden.length > 0) {
    refuse(
      `the scaffold declares \`pnpm.overrides\` for ${overridden.join(', ')}. An override ` +
        `replaces the semver range this mode exists to resolve, so the install would succeed ` +
        `without the registry answering for anything.`,
    );
  }
  notes.push(
    `installing from the registry the scaffold configured for ${scopes.join(', ')}, with no ` +
      `overrides — the token is read from the environment by pnpm's own \`.npmrc\` expansion ` +
      `and is never written anywhere`,
  );
}

/** Where each declared package really resolved, for A4. */
function resolvedPackages(
  target: string,
  declared: readonly string[],
): readonly { specifier: string; realPath: string }[] {
  const found: { specifier: string; realPath: string }[] = [];
  for (const name of declared) {
    const path = join(target, 'node_modules', name);
    if (!existsSync(path)) continue;
    found.push({ specifier: name, realPath: realpathSync(path) });
  }
  return found;
}

/**
 * The environment that points the instance at a backend.
 *
 * **`PUBLIC_API_BASE_URL` is this harness's input and is not a variable the
 * storefront reads** — that was the whole of the defect this function exists to
 * close. The scaffolded storefront's fetchers read the names its own
 * `.env.example` declares and fall back to a compiled-in `http://localhost:3001`
 * when none is set, so a run that exported only the harness's name configured
 * nothing: A6 was green whenever the run's backend happened to sit on the
 * fallback address and red whenever it sat anywhere else, in both cases for a
 * reason that says nothing about the criterion.
 *
 * The names come off the instance's own copy of that file, through the same
 * derivation `endora new storefront` prints in its next steps, so the criterion
 * and the command cannot come to disagree about what an instance reads. A copy
 * that declares none is a **refusal**: with no name to set, every later
 * observation would be the fallback's.
 */
function backendEnvironment(
  target: string,
  backend: string,
  names: readonly string[],
): Record<string, string> {
  if (names.length === 0) {
    refuse(
      `${join(target, '.env.example')} declares no variable naming a backend, so this run has ` +
        `no way to point the instance at ${backend}. Every boot would reach the storefront's ` +
        `compiled-in fallback instead, and report on it as though it were the backend.`,
    );
  }
  return Object.fromEntries(names.map((name) => [name, backend]));
}

/** An address nothing listens on, for A6's discrimination probe. */
const CLOSED_ADDRESS = 'http://127.0.0.1:1';

/**
 * The public origin this run builds the instance with, for A7.
 *
 * **Not the address the instance is served at, and deliberately so.** A
 * production storefront sits behind a proxy and is built with the origin a
 * visitor types, never with the loopback port its container listens on — so a
 * criterion using `http://127.0.0.1:<port>` would be measuring a shape no
 * deployment has. What A7 needs of this value is that it is *not*
 * `COMPILED_IN_SITE_ORIGIN`, which is what makes a canonical carrying it
 * evidence rather than a coincidence.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere. That is the point: a
 * canonical is metadata a crawler reads, nothing in this run fetches it, and a
 * hostname that cannot resolve can never be mistaken for a real one.
 */
const SITE_ORIGIN_UNDER_TEST = 'https://shop.acceptance.invalid';

/**
 * One boot of the built instance: `next start`, then `/`, then stop.
 *
 * The status line is A6's observation, not the page — a storefront whose backend
 * is unreachable still has to *serve*, and which of those two happened is what
 * the caller compares across the two boots.
 */
async function serveOnce(
  target: string,
  environment: Readonly<Record<string, string>>,
): Promise<{ status: number | null; body: string | null; output: string }> {
  const port = 3200 + Math.floor(Math.random() * 300);
  const { spawn } = await import('node:child_process');
  const child = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
    cwd: target,
    // The boot is a process of the instance's, so it gets the instance's
    // environment and not this harness's — `insideInstance`, for the reason
    // `instanceEnvironment` gives. `PORT` is this run's and is declared by
    // nothing in the copy, so it survives the withholding untouched.
    env: { ...process.env, ...insideInstance(environment), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (Date.now() > deadline) return { status: null, body: null, output };
      await new Promise((wait) => setTimeout(wait, 1_000));
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
          signal: AbortSignal.timeout(10_000),
        });
        // The body is A7's subject and A6 ignores it. Read here rather than in a
        // second request because this one already has the page, and a second
        // `next start` for it would measure a different boot.
        const body = await response.text().catch(() => null);
        return { status: response.status, body, output };
      } catch {
        // not listening yet
      }
    }
  } finally {
    child.kill('SIGTERM');
  }
}

/**
 * A6 — the built storefront boots, and the run can tell what it booted against.
 *
 * Two boots: the configured one, and a probe with the same variables pointed at
 * {@link CLOSED_ADDRESS}. The judgement is `evaluateA6`'s; everything here is
 * the observation. The probe is skipped when the first boot already failed —
 * there is nothing left to discriminate — and its absence is then irrelevant,
 * because a 5xx from the configured boot is a red criterion whatever the
 * fallback would have done.
 */
async function boot(
  target: string,
  backendNames: readonly string[],
  siteOrigin: string | null,
): Promise<readonly AssertionResult[]> {
  // A7's subject is the page the configured boot served, so it is read off that
  // boot rather than from one of its own. Where there is no boot to read there
  // is no canonical either, and `evaluateA7` says so in its own words instead of
  // inheriting A6's.
  const canonicalOf = (body: string | null): AssertionResult =>
    evaluateA7({
      configured: siteOrigin,
      canonical: body === null ? null : canonicalHrefIn(body),
      path: '/',
    });

  const backend = process.env['PUBLIC_API_BASE_URL'];
  if (backend === undefined || backend.length === 0) {
    return [
      evaluateA6({
        backend: null,
        status: null,
        probeStatus: null,
        probeAddress: CLOSED_ADDRESS,
      }),
      {
        id: 'A7',
        state: 'unmeasured',
        detail: 'there was no boot to read a canonical from',
      },
    ];
  }
  const configured = await serveOnce(target, backendEnvironment(target, backend, backendNames));
  if (configured.status === null || configured.status >= 500) {
    // No fabricated probe value here: `evaluateA6` decides a failed boot before
    // it looks at the probe, so `null` is the honest reading of a probe that was
    // never run (`check:fixture-substitution`'s rule, one directory over).
    return [
      evaluateA6({
        backend,
        status: configured.status,
        probeStatus: null,
        probeAddress: CLOSED_ADDRESS,
        output: configured.output,
      }),
      {
        id: 'A7',
        state: 'unmeasured',
        detail:
          'the configured boot did not serve a page, so its head carries no canonical to read',
      },
    ];
  }
  const probe = await serveOnce(
    target,
    backendEnvironment(target, CLOSED_ADDRESS, backendNames),
  );
  return [
    evaluateA6({
      backend,
      status: configured.status,
      probeStatus: probe.status,
      probeAddress: CLOSED_ADDRESS,
      output: configured.output,
    }),
    canonicalOf(configured.body),
  ];
}

async function main(): Promise<void> {
  const againstExpectation = process.argv.includes('--against-expectation');
  const { mode, registry } = resolveMode();

  const temp = mkdtempSync(join(tmpdir(), 'endora-storefront-acceptance-'));
  const tarballDir = join(temp, 'artefact');
  mkdirSync(tarballDir, { recursive: true });
  if (realpathSync(temp).startsWith(`${realpathSync(REPO_ROOT)}/`)) {
    refuse(
      `the temporary directory ${temp} is inside the checkout, so an install there would be ` +
        `reachable by relative specifier and by the workspace globs — the two things this ` +
        `criterion exists to leave behind`,
    );
  }
  const target = join(temp, 'instance');

  const results: AssertionResult[] = [];
  try {
    scaffold(target, registry, await resolveScaffoldInputs());

    // A1/A2 read the copy, through the command's own derivation.
    const {
      outwardReferences,
      backendAddressVariablesOf,
      declaredVariablesOf,
      storefrontAddressVariablesOf,
    } = (await import('@endora-commerce/cli')) as {
      outwardReferences: (reference: {
        repoRoot: string;
        dir: string;
        files: readonly string[];
        manifest: Record<string, unknown>;
      }) => readonly { file: string; specifier: string }[];
      backendAddressVariablesOf: (storefrontDir: string) => Promise<readonly string[]>;
      declaredVariablesOf: (storefrontDir: string) => Promise<readonly string[]>;
      storefrontAddressVariablesOf: (storefrontDir: string) => Promise<readonly string[]>;
    };

    // Everything below this line that runs inside the instance goes through
    // `insideInstance`, which needs this. Loaded from the copy the moment there
    // is a copy, so the install is covered as well as the build and the boot.
    instanceDeclaredVariables = await declaredVariablesOf(target);
    if (instanceDeclaredVariables.length === 0) {
      refuse(
        `the copy at ${target} declares no environment input its own process reads, so this ` +
          `run cannot tell which of the variables it happens to carry belong to the instance. ` +
          `Every one of them would reach \`next build\` and \`next start\`, where a name the ` +
          `instance reads displaces the value \`endora new storefront\` wrote into its \`.env\` ` +
          `— and A5 to A7 would be measuring this harness's configuration rather than the ` +
          `command's.`,
      );
    }

    const manifestText = readFileSync(join(target, 'package.json'), 'utf8');
    results.push(
      evaluateA1(
        outwardReferences({
          repoRoot: temp,
          dir: target,
          files: listFiles(target),
          manifest: JSON.parse(manifestText) as Record<string, unknown>,
        }),
      ),
    );
    results.push(evaluateA2(manifestText));

    const declared = declaredPackages(target);
    if (mode === 'tarball') packAndPin(target, tarballDir, declared);
    else assertRegistryNpmrc(target, declared);

    // **Appended, never written over.** In the registry mode the scaffold has
    // already put the scope and the auth line here, and truncating the file
    // would send every fetch to the default registry — an install that measured
    // npmjs while reporting on ours. These two lines are the harness's own and
    // belong to neither mode: the instance is outside the checkout and must not
    // be adopted by any workspace above the temporary directory, and a peer
    // range the reference storefront already tolerates is not this criterion's
    // subject.
    appendFileSync(
      join(target, '.npmrc'),
      'ignore-workspace=true\nstrict-peer-dependencies=false\n',
    );

    const installed = run('pnpm', ['install', '--no-frozen-lockfile'], {
      cwd: target,
      env: insideInstance(),
    });
    results.push(
      evaluateProcess(
        'A3',
        installed.code,
        installed.output,
        mode === 'tarball'
          ? `pnpm install succeeded outside the checkout, from ${String(declared.length)} packed tarballs`
          : `pnpm install succeeded outside the checkout, resolving ${String(declared.length)} ` +
            `published ranges from ${String(registry)}`,
      ),
    );
    results.push(evaluateA4(resolvedPackages(target, declared), realpathSync(REPO_ROOT)));

    if (installed.code === 0) {
      // The build reads the backend address too: Next inlines a `NEXT_PUBLIC_`
      // variable into the browser bundle, so a build run without it bakes the
      // storefront's compiled-in fallback and no later `next start` can change
      // it. The names are the instance's own declaration, through the same
      // derivation the command prints.
      const backendNames = await backendAddressVariablesOf(target);
      const siteNames = await storefrontAddressVariablesOf(target);
      const backend = process.env['PUBLIC_API_BASE_URL'];
      const buildEnvironment =
        backend === undefined || backend.length === 0
          ? {}
          : backendEnvironment(target, backend, backendNames);
      notes.push(
        backendNames.length === 0
          ? 'the instance declares no backend variable'
          : `pointed ${backendNames.join(', ')} at the backend — the names are the instance's ` +
            `own declaration, not this harness's \`PUBLIC_API_BASE_URL\`, which no file ` +
            `in the storefront reads`,
      );
      // A7's value is **not** added to `buildEnvironment`, deliberately: it
      // reaches this build through the `.env` the command wrote from the flag
      // this run supplied, so what A7 measures is the whole chain — declared,
      // resolved, written, inlined, served — rather than a variable the harness
      // exported over the top of it.
      notes.push(
        siteNames.length === 0
          ? 'the instance declares no variable naming its own public address, so A7 has no subject'
          : `built with ${siteNames.join(', ')} = ${SITE_ORIGIN_UNDER_TEST}, out of the ` +
            `\`.env\` the command wrote — not the ${COMPILED_IN_SITE_ORIGIN} an unconfigured ` +
            `storefront names`,
      );
      // The build is the instance's own process, so it is given the instance's
      // environment: this harness's is withheld wherever the copy declares the
      // name. Disclosed rather than done quietly — a reader of A5 has to be able
      // to tell a build configured by the `.env` the command wrote from one
      // configured by whatever the job that ran this happened to export.
      const buildOverlay = instanceEnvironment({
        ambient: process.env,
        declared: instanceDeclaredVariables,
        supplied: buildEnvironment,
      });
      notes.push(
        buildOverlay.withheld.length === 0
          ? `withheld nothing from the instance's own processes: this harness's environment ` +
            `carries none of the ${String(instanceDeclaredVariables.length)} variables the copy ` +
            `declares`
          : `withheld ${buildOverlay.withheld.join(', ')} from the instance's own processes — ` +
            `this harness's environment is not a client's, and Next does not let a \`.env\` ` +
            `override a variable the process already carries, so an inherited one would ` +
            `configure the instance over the top of what \`endora new storefront\` wrote`,
      );
      const built = run('pnpm', ['run', 'build'], { cwd: target, env: buildOverlay.overlay });
      results.push(
        evaluateProcess('A5', built.code, built.output, 'next build succeeded outside the checkout'),
      );
      if (built.code === 0) {
        results.push(
          ...(await boot(
            target,
            backendNames,
            siteNames.length === 0 ? null : SITE_ORIGIN_UNDER_TEST,
          )),
        );
      } else {
        results.push({ id: 'A6', state: 'unmeasured', detail: 'there is no build to boot' });
        results.push({ id: 'A7', state: 'unmeasured', detail: 'there is no build to boot' });
      }
    } else {
      results.push({ id: 'A5', state: 'unmeasured', detail: 'there is no install to build' });
      results.push({ id: 'A6', state: 'unmeasured', detail: 'there is no build to boot' });
      results.push({ id: 'A7', state: 'unmeasured', detail: 'there is no build to boot' });
    }
  } finally {
    if (process.env['KEEP_STOREFRONT_ACCEPTANCE'] !== '1') {
      rmSync(temp, { recursive: true, force: true });
    } else notes.push(`kept ${temp}`);
  }

  console.log(formatReport(results, notes, mode));

  if (!againstExpectation) {
    process.exit(exitCodeFor(results));
  }
  if (!existsSync(EXPECTATION_FILE)) refuse(`${EXPECTATION_FILE} is not there`);
  const expectation = JSON.parse(readFileSync(EXPECTATION_FILE, 'utf8')) as AcceptanceExpectation;
  const drift = compareToExpectation(results, expectation, mode);
  for (const line of drift) console.error(`[storefront-acceptance] drift: ${line}`);
  if (drift.length === 0) {
    console.log('[storefront-acceptance] the run agrees with the recorded expectation.');
  } else {
    console.error(
      '[storefront-acceptance] update backend/acceptance/storefront-scaffold-expected-state.json ' +
        'in the merge request that moved this, with what changed and why.',
    );
  }
  process.exit(exitCodeForExpectation(drift));
}

function listFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else found.push(path);
    }
  };
  walk(root, '');
  return found;
}

await main();
