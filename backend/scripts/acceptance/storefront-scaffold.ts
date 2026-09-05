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

import {
  compareToExpectation,
  evaluateA1,
  evaluateA2,
  evaluateA4,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  formatReport,
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

/** The `endora` entry point, run from source so the criterion measures this branch. */
function scaffold(target: string, registry: string | null): void {
  const tsx = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsx)) refuse(`${tsx} is missing — run \`pnpm install\` first`);
  const entry = join(REPO_ROOT, 'packages', 'cli', 'src', 'bin', 'endora.ts');
  if (!existsSync(entry)) refuse(`${entry} is not there, so there is no command to measure`);
  const result = run(
    tsx,
    [entry, 'new', 'storefront', target, ...(registry === null ? [] : ['--registry', registry])],
    { cwd: REPO_ROOT },
  );
  if (result.code !== 0) {
    refuse(`\`endora new storefront\` exited ${String(result.code)}:\n${result.output}`);
  }
  notes.push(
    registry === null
      ? `scaffolded into ${target}`
      : `scaffolded into ${target} with --registry ${registry}`,
  );
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
 * A6 — the built storefront boots and answers.
 *
 * `next start` over the build A5 produced, with the health of the answer read
 * off the status line rather than off the page: a storefront with no backend
 * reachable still has to *serve*, and what it serves is `PUBLIC_API_BASE_URL`'s
 * business. When no backend is configured the assertion is `unmeasured` rather
 * than green — a boot that renders an error page is not a boot this criterion
 * should call a pass.
 */
async function boot(target: string): Promise<AssertionResult> {
  const backend = process.env['PUBLIC_API_BASE_URL'];
  if (backend === undefined || backend.length === 0) {
    return {
      id: 'A6',
      state: 'unmeasured',
      detail:
        'PUBLIC_API_BASE_URL names no backend, so a boot would measure the storefront\'s ' +
        'error page rather than the storefront',
    };
  }
  const port = 3200 + Math.floor(Math.random() * 300);
  const { spawn } = await import('node:child_process');
  const child = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
    cwd: target,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (Date.now() > deadline) {
        return { id: 'A6', state: 'fail', detail: `next start did not answer in 90 s: ${output.slice(-400)}` };
      }
      await new Promise((wait) => setTimeout(wait, 1_000));
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/`, {
          signal: AbortSignal.timeout(10_000),
        });
        return response.status < 500
          ? {
              id: 'A6',
              state: 'pass',
              detail: `next start answered / with ${String(response.status)} against ${backend}`,
            }
          : {
              id: 'A6',
              state: 'fail',
              detail: `next start answered / with ${String(response.status)} against ${backend}`,
            };
      } catch {
        // not listening yet
      }
    }
  } finally {
    child.kill('SIGTERM');
  }
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
    scaffold(target, registry);

    // A1/A2 read the copy, through the command's own derivation.
    const { outwardReferences } = (await import('@endora-commerce/cli')) as {
      outwardReferences: (reference: {
        repoRoot: string;
        dir: string;
        files: readonly string[];
        manifest: Record<string, unknown>;
      }) => readonly { file: string; specifier: string }[];
    };
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

    const installed = run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: target });
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
      const built = run('pnpm', ['run', 'build'], { cwd: target });
      results.push(
        evaluateProcess('A5', built.code, built.output, 'next build succeeded outside the checkout'),
      );
      if (built.code === 0) results.push(await boot(target));
      else {
        results.push({
          id: 'A6',
          state: 'unmeasured',
          detail: 'there is no build to boot',
        });
      }
    } else {
      results.push({ id: 'A5', state: 'unmeasured', detail: 'there is no install to build' });
      results.push({ id: 'A6', state: 'unmeasured', detail: 'there is no build to boot' });
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
