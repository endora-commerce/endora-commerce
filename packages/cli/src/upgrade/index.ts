/**
 * `endora upgrade [<version>]` — an instance from one release to the next
 * (`specs/140-instance-upgrade/`).
 *
 * ## Why it exists
 *
 * The scaffolded README said *"a fix reaches you through `pnpm update`"*, and
 * measured against npmjs that command does three wrong things to an instance
 * (spec M1…M4): it leaves the exact `contracts` pin behind, so two copies of
 * the contracts resolve and every module reports an unmet peer while the
 * command exits 0; it cannot cross a minor at all, because in `0.x` a caret
 * stops at the next one; and it never moves a release package pnpm installed
 * as a peer by itself. Every one of those is silent. This verb is the one
 * command that does the upgrade the way the release is built — every package
 * of the release at one number — and then runs the instance's own `setup`.
 *
 * ## What belongs to the release is a name, never a scope (FR-002)
 *
 * The paid modules share the scope and version on their own, so "every
 * `@endora-commerce/*` package" would move one to a version that does not
 * exist. The population is the release index this CLI carries
 * (`lib/release-index.ts`) — the release's own statement of what it published —
 * matched by name. Anything else is left as written and **reported**, because
 * a package the command looked at and skipped is a line the operator should see.
 *
 * ## Validate completely, then write, then run
 *
 * `install/index.ts`' discipline. Every precondition — the instance, its
 * installed platform, the target, every declared release package published at
 * it, the storefront — is decided before the first byte is written, and every
 * failure is one refusal naming all of them. Then the manifests and lockfiles
 * are written; then the commands run, each printed first, a failure exiting
 * with that step's own code and printing what is left. `--dry-run` stops after
 * the plan.
 *
 * ## What it writes, and why the lockfile is edited at all (FR-004)
 *
 * Each range is rewritten **in place** in the manifest text — operator kept,
 * version moved, no other byte touched — because a client's manifest is theirs
 * and a re-serialised one is a diff they did not ask for (M3 is `pnpm update`
 * doing exactly that). The lockfile loses every entry naming a release package
 * at another version than the target: pnpm keeps the resolution of a peer it
 * installed by itself through every `update`, `install`, `dedupe` and
 * `--fix-lockfile` (M4), and a dropped entry is the one thing it re-resolves.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { findInstanceRoot } from '../generate/index.js';
import { ownReleaseIndexPath, parseReleaseIndex } from '../lib/release-index.js';
import { workspaceGlobs } from '../new-module/host.js';

/** A refusal the operator can act on — exit 1. */
export class UpgradeInputError extends Error {
  override readonly name = 'UpgradeInputError';
}

/** An input this run could not read — exit 2. */
export class UpgradeHostError extends Error {
  override readonly name = 'UpgradeHostError';
}

/**
 * Which version of `name` the registry resolves `spec` to — `'latest'` or an
 * exact version — or `null` when it publishes none.
 */
export type RegistryProbe = (name: string, spec: string) => Promise<string | null>;

/** One command of the run. Data, so a test asserts the list rather than a shell. */
export interface UpgradeStep {
  readonly id: 'install' | 'setup' | 'storefront-install';
  /** What is printed before it runs — what a person types. */
  readonly command: string;
  readonly purpose: string;
  readonly bin: string;
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface UpgradeOptions {
  /** Where it was typed; the instance is the workspace root above it. */
  readonly cwd?: string | undefined;
  /** The release to move to. Absent: the registry's `latest` of the platform. */
  readonly version?: string | undefined;
  /**
   * The storefront. `undefined` takes the sibling `endora install` writes
   * (`<dir>-storefront`) when it is there; a string names one, relative to
   * {@link cwd}; `false` leaves every storefront alone.
   */
  readonly storefront?: string | false | undefined;
  readonly dryRun?: boolean | undefined;
  /** Where each line goes as it is produced. Every line is on the result too. */
  readonly echo?: ((line: string) => void) | undefined;
  /** How a step runs. Defaults to spawning it with the terminal inherited. */
  readonly run?: ((step: UpgradeStep) => Promise<number>) | undefined;
  /** Which versions are published. Defaults to asking `pnpm view` in the instance. */
  readonly registry?: RegistryProbe | undefined;
  /** The release index naming the release's packages. Defaults to this CLI's own. */
  readonly releaseIndexFile?: string | undefined;
}

/** One range this run moves. */
export interface RangeChange {
  readonly name: string;
  readonly from: string;
  readonly to: string;
}

/** A dependency this run looked at and did not move, and why. */
export interface LeftAlone {
  readonly name: string;
  readonly spec: string;
  readonly why: 'not part of this release' | 'not a version range';
}

/** Everything decided about one file. */
export interface FilePlan {
  /** Absolute. */
  readonly file: string;
  /** Which repository it belongs to: they are installed by separate commands. */
  readonly tree: 'instance' | 'storefront';
  readonly before: string;
  readonly after: string;
  readonly changes: readonly RangeChange[];
  readonly left: readonly LeftAlone[];
  /** For a lockfile: the entry keys it drops. */
  readonly dropped: readonly string[];
}

export interface UpgradeResult {
  readonly instanceDir: string;
  readonly storefrontDir: string | null;
  /** The platform version installed when the run started. */
  readonly from: string;
  readonly to: string;
  /** FR-007: nothing to write and nothing to run. */
  readonly upToDate: boolean;
  readonly files: readonly FilePlan[];
  /** Every step the run planned, whether or not it ran. */
  readonly steps: readonly UpgradeStep[];
  readonly exitCode: number;
  readonly lines: readonly string[];
}

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** An exact version with an optional `^` or `~` — the only specs this verb moves. */
const MOVABLE = /^([~^]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/**
 * The spec moved to `target` with its operator kept, or `null` when the spec
 * is not a version range this verb may move (FR-003): an exact pin stays exact
 * — the reason it is exact is that the release moves as one number — `^` stays
 * `^` and `~` stays `~`. Anything else (`file:`, `workspace:`, a tag, a range
 * with a bound) was written by somebody on purpose, so it is theirs.
 */
export function rewriteRange(spec: string, target: string): string | null {
  const match = MOVABLE.exec(spec.trim());
  if (match === null) return null;
  return `${match[1]!}${target}`;
}

/** Semver precedence over `x.y.z[-pre]`, which is every version a release carries. */
export function compareVersions(left: string, right: string): number {
  const split = (version: string): [number[], string | null] => {
    const [core, ...pre] = version.split('-');
    return [core!.split('.').map(Number), pre.length > 0 ? pre.join('-') : null];
  };
  const [a, preA] = split(left);
  const [b, preB] = split(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (preA === preB) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  return preA.localeCompare(preB, 'en', { numeric: true });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One manifest's release ranges, moved in its own text (FR-002, FR-003).
 *
 * The JSON is parsed to learn **which** entries are dependencies, and the text
 * is edited to change them, so the file keeps its indentation, its order and
 * every line the run had no business with.
 */
export function rewriteManifestText(
  text: string,
  release: ReadonlySet<string>,
  target: string,
): {
  readonly text: string;
  readonly changes: readonly RangeChange[];
  readonly left: readonly LeftAlone[];
  /** The release packages this manifest declares at a version this verb moves. */
  readonly declared: readonly string[];
} {
  const manifest = JSON.parse(text) as Record<string, unknown>;
  const changes = new Map<string, RangeChange>();
  const left = new Map<string, LeftAlone>();
  const declared = new Set<string>();
  let after = text;
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [name, spec] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      const scoped = name.startsWith('@');
      if (!release.has(name)) {
        // A third-party package is nobody's business here. A package of a
        // scope the release uses but not in the release — a paid module — is
        // reported, because skipping it silently is a decision nobody saw.
        if (scoped && [...release].some((member) => member.split('/')[0] === name.split('/')[0])) {
          left.set(name, { name, spec, why: 'not part of this release' });
        }
        continue;
      }
      const moved = rewriteRange(spec, target);
      if (moved === null) {
        left.set(name, { name, spec, why: 'not a version range' });
        continue;
      }
      declared.add(name);
      if (moved === spec) continue;
      changes.set(name, { name, from: spec, to: moved });
      after = after.replace(
        new RegExp(`("${escapeRegExp(name)}"\\s*:\\s*")${escapeRegExp(spec)}"`, 'g'),
        (_whole, head: string) => `${head}${moved}"`,
      );
    }
  }
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  return {
    text: after,
    changes: [...changes.values()].sort(byName),
    left: [...left.values()].sort(byName),
    declared: [...declared].sort(),
  };
}

/**
 * A `pnpm-lock.yaml` without the entries that name a release package at
 * another version than `target` (FR-004).
 *
 * Only the `packages:` and `snapshots:` tables are edited, entry by entry — a
 * top-level key at two spaces of indentation and its body. The `importers:`
 * table is left for pnpm to reconcile against the manifests it reads next,
 * which is the reconciliation it does on every install.
 */
export function pruneLockfile(
  text: string,
  release: ReadonlySet<string>,
  target: string,
): { readonly text: string; readonly dropped: readonly string[] } {
  const stale = (key: string): boolean => {
    for (const match of key.matchAll(/(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)@(\d[^()\s':]*)/g)) {
      if (release.has(match[1]!) && match[2]! !== target) return true;
    }
    return false;
  };
  const lines = text.split('\n');
  const kept: string[] = [];
  const dropped: string[] = [];
  let table: string | null = null;
  let dropping = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      table = line.replace(/:.*$/, '');
      dropping = false;
      kept.push(line);
      continue;
    }
    if ((table === 'packages' || table === 'snapshots') && /^ {2}\S/.test(line)) {
      const key = line.trim().replace(/:\s*(?:\{\})?\s*$/, '').replace(/^['"]|['"]$/g, '');
      dropping = stale(key);
      if (dropping) dropped.push(key);
    }
    if (!dropping) kept.push(line);
  }
  return { text: dropped.length === 0 ? text : kept.join('\n'), dropped };
}

/** The workspace members, from `pnpm-workspace.yaml`: a directory, or one level of `*`. */
function memberDirs(root: string): readonly string[] {
  const dirs = new Set<string>([root]);
  for (const glob of workspaceGlobs(root)) {
    if (glob.startsWith('!')) continue;
    if (glob.endsWith('/*')) {
      const parent = join(root, glob.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent)) {
        const dir = join(parent, entry);
        if (existsSync(join(dir, 'package.json'))) dirs.add(dir);
      }
    } else if (!glob.includes('*') && existsSync(join(root, glob, 'package.json'))) {
      dirs.add(join(root, glob));
    }
  }
  return [...dirs];
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new UpgradeHostError(
      `${file} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** A run of `pnpm view`, in the instance, so its `.npmrc` and registry apply. */
function pnpmRegistry(cwd: string): RegistryProbe {
  return (name, spec) =>
    new Promise((resolveVersion) => {
      const child = spawn('pnpm', ['view', `${name}@${spec}`, 'version', '--json'], {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.on('error', () => resolveVersion(null));
      child.on('close', (code) => {
        if (code !== 0 || out.trim().length === 0) return resolveVersion(null);
        try {
          const parsed = JSON.parse(out) as unknown;
          const value = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
          resolveVersion(typeof value === 'string' ? value : null);
        } catch {
          resolveVersion(null);
        }
      });
    });
}

/** `items` through `probe`, at most `limit` at a time, answers in order. */
async function bounded<T, R>(items: readonly T[], limit: number, probe: (item: T) => Promise<R>): Promise<R[]> {
  const answers: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      answers[index] = await probe(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
}

function spawnStep(step: UpgradeStep): Promise<number> {
  return new Promise((resolveCode) => {
    const child = spawn(step.bin, [...step.argv], { cwd: step.cwd, stdio: 'inherit' });
    child.on('error', () => resolveCode(127));
    child.on('close', (code) => resolveCode(code ?? 1));
  });
}

/** The default sibling `endora install` writes, or the one named. */
function resolveStorefront(
  instanceDir: string,
  cwd: string,
  storefront: string | false | undefined,
  refusals: string[],
): string | null {
  if (storefront === false) return null;
  if (storefront === undefined) {
    const sibling = join(dirname(instanceDir), `${basename(instanceDir)}-storefront`);
    return existsSync(join(sibling, 'package.json')) ? sibling : null;
  }
  const named = isAbsolute(storefront) ? storefront : resolve(cwd, storefront);
  if (!existsSync(join(named, 'package.json'))) {
    refusals.push(
      `\`--storefront-dir ${storefront}\` names ${named}, which holds no package.json. Name the ` +
        'storefront repository, or pass `--no-storefront` to upgrade the instance alone.',
    );
    return null;
  }
  return named;
}

/** Run `endora upgrade`. Throws a refusal before anything is written. */
export async function runUpgrade(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const lines: string[] = [];
  const say = (line: string): void => {
    lines.push(line);
    options.echo?.(line);
  };

  // --- what this run is ---------------------------------------------------
  const instanceDir = findInstanceRoot(cwd);
  if (instanceDir === null || !existsSync(join(instanceDir, 'package.json'))) {
    throw new UpgradeHostError(
      `no \`pnpm-workspace.yaml\` above ${cwd}, so there is no instance to upgrade. Run it inside ` +
        'the tree `endora install` or `endora new instance` wrote — as `pnpm run upgrade`.',
    );
  }
  const indexFile = options.releaseIndexFile ?? ownReleaseIndexPath();
  const release = new Set(parseReleaseIndex(readText(indexFile), indexFile).packages.map((entry) => entry.name));
  const platformName = [...release].find((name) => name.endsWith('/platform'));
  if (platformName === undefined) {
    throw new UpgradeHostError(`${indexFile} names no platform package, so it describes no release.`);
  }

  const refusals: string[] = [];
  const target = options.version?.trim();
  if (target !== undefined && !VERSION.test(target)) {
    // Before the registry is asked anything: a range is not a release.
    throw new UpgradeInputError(
      `\`${target}\` is not a release version. Name one exactly — \`endora upgrade 0.102.0\` — ` +
        'or name none to take the latest. Nothing was written.',
    );
  }

  const rootManifest = JSON.parse(readText(join(instanceDir, 'package.json'))) as {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  };
  if (typeof rootManifest.scripts?.['setup'] !== 'string') {
    refusals.push(
      `${join(instanceDir, 'package.json')} declares no \`setup\` script, which is what runs ` +
        'after the packages move. An instance declares one; this is not an instance root.',
    );
  }
  const installedManifest = join(instanceDir, 'node_modules', ...platformName.split('/'), 'package.json');
  let installed: string | null = null;
  if (existsSync(installedManifest)) {
    installed = (JSON.parse(readText(installedManifest)) as { version?: string }).version ?? null;
  }
  // The release the manifest names, which is what the operator chose and what
  // the report says it moves from. It differs from the installed one exactly
  // when a caret reached a newer patch than the exact pin beside it — which is
  // every instance scaffolded from a release after its next patch was out.
  const platformSpec = rootManifest.dependencies?.[platformName];
  const declaredVersion =
    typeof platformSpec === 'string' ? (MOVABLE.exec(platformSpec.trim())?.[2] ?? null) : null;
  if (installed === null) {
    refusals.push(
      `${platformName} is not installed in ${instanceDir}, so there is no installed release to ` +
        'upgrade from. Run `pnpm install` first.',
    );
  }
  const storefrontDir = resolveStorefront(instanceDir, cwd, options.storefront, refusals);
  if (refusals.length > 0) throw refusal(refusals);

  const registry = options.registry ?? pnpmRegistry(instanceDir);
  let to = target;
  if (to === undefined) {
    const latest = await registry(platformName, 'latest');
    if (latest === null) {
      throw new UpgradeHostError(
        `the registry answered no \`latest\` for ${platformName}. Name the version: ` +
          '`endora upgrade <version>`.',
      );
    }
    to = latest;
  }
  const from = declaredVersion ?? installed!;
  const newest =
    declaredVersion !== null && compareVersions(declaredVersion, installed!) > 0
      ? declaredVersion
      : installed!;
  if (compareVersions(to, newest) < 0) {
    throw new UpgradeInputError(
      `${to} is older than the installed ${newest}, and an upgrade does not go back: migrations ` +
        'do not run backwards. Nothing was written.',
    );
  }

  // --- the plan, decided completely before anything is written ------------
  const trees = [
    { tree: 'instance' as const, dir: instanceDir, manifests: memberDirs(instanceDir) },
    ...(storefrontDir === null
      ? []
      : [{ tree: 'storefront' as const, dir: storefrontDir, manifests: [storefrontDir] }]),
  ];
  const files: FilePlan[] = [];
  const declared = new Set<string>();
  for (const tree of trees) {
    for (const dir of tree.manifests) {
      const file = join(dir, 'package.json');
      const before = readText(file);
      let rewritten: ReturnType<typeof rewriteManifestText>;
      try {
        rewritten = rewriteManifestText(before, release, to);
      } catch {
        throw new UpgradeHostError(`${file} could not be read as JSON.`);
      }
      for (const name of rewritten.declared) declared.add(name);
      files.push({ file, tree: tree.tree, before, after: rewritten.text, changes: rewritten.changes, left: rewritten.left, dropped: [] });
    }
    const lockfile = join(tree.dir, 'pnpm-lock.yaml');
    if (existsSync(lockfile) && statSync(lockfile).isFile()) {
      const before = readText(lockfile);
      const pruned = pruneLockfile(before, release, to);
      files.push({ file: lockfile, tree: tree.tree, before, after: pruned.text, changes: [], left: [], dropped: pruned.dropped });
    }
  }

  const moves = (tree: FilePlan['tree']): boolean =>
    files.some((plan) => plan.tree === tree && plan.before !== plan.after);
  // An instance whose manifests already name the target but whose install
  // does not — a run whose install failed — still has its install to do.
  const instanceMoves = moves('instance') || installed !== to;
  const storefrontMoves = moves('storefront');

  if (!instanceMoves && !storefrontMoves) {
    say(`endora upgrade — ${instanceDir} is already at ${to} — nothing to do.`);
    say(
      'Every release package names it, it is the one installed, and no lockfile holds another. ' +
        'If an earlier upgrade stopped after its install, `pnpm run setup` finishes it and is ' +
        'safe to run again.',
    );
    return { instanceDir, storefrontDir, from, to, upToDate: true, files, steps: [], exitCode: 0, lines };
  }

  // Every release package the manifests declare has to exist at the target —
  // asked of the registry now, so a release that dropped one is a refusal and
  // not a half-written tree with a failed install under it.
  const names = [...declared].sort();
  const published = await bounded(names, 8, (name) => registry(name, to!));
  const absent = names.filter((_name, index) => published[index] !== to);
  if (absent.length > 0) {
    const list = absent.map((name) => `${name}@${to!}`).join(', ');
    throw new UpgradeInputError(
      absent.includes(platformName)
        ? `the registry publishes no ${platformName}@${to}, so there is no release ${to} to move ` +
            'to. Nothing was written.'
        : `release ${to} does not publish ${absent.length === 1 ? 'a package' : `${String(absent.length)} packages`} ` +
            `this instance declares: ${list}. Remove ${absent.length === 1 ? 'it' : 'them'} from ` +
            'the manifest — or wait for the release that carries them. Nothing was written.',
    );
  }

  const steps: UpgradeStep[] = [];
  if (instanceMoves) {
    steps.push(
      {
        id: 'install',
        command: 'pnpm install',
        purpose: `the instance's packages, at ${to}`,
        bin: 'pnpm',
        argv: ['install'],
        cwd: instanceDir,
      },
      {
        id: 'setup',
        command: 'pnpm run setup',
        purpose: 'generate, build, migrate and install any module the release adds — each idempotent',
        bin: 'pnpm',
        argv: ['run', 'setup'],
        cwd: instanceDir,
      },
    );
  }
  if (storefrontMoves && storefrontDir !== null) {
    steps.push({
      id: 'storefront-install',
      command: 'pnpm install',
      purpose: `the storefront's release packages, at ${to}; its own files are yours and are not touched`,
      bin: 'pnpm',
      argv: ['install'],
      cwd: storefrontDir,
    });
  }

  // --- report --------------------------------------------------------------
  const dry = options.dryRun === true;
  say(
    `endora upgrade — ${instanceDir}: ${from} → ${to}` +
      `${target === undefined ? " (the registry's latest)" : ''}${dry ? ' — dry run, nothing written and nothing run' : ''}`,
  );
  const shown = (plan: FilePlan): string =>
    plan.tree === 'instance'
      ? relative(instanceDir, plan.file)
      : join(`../${basename(storefrontDir!)}`, relative(storefrontDir!, plan.file));
  for (const plan of files) {
    if (plan.changes.length > 0) {
      say(`  ${shown(plan)}: ${String(plan.changes.length)} release range(s) to ${to} — an exact pin stays exact`);
      if (dry) for (const change of plan.changes) say(`    ${change.name} ${change.from} → ${change.to}`);
    }
    for (const kept of plan.left) say(`  ${shown(plan)}: left as written: ${kept.name} ${kept.spec} — ${kept.why}`);
    if (plan.dropped.length > 0) {
      say(
        `  ${shown(plan)}: ${String(plan.dropped.length)} entr${plan.dropped.length === 1 ? 'y' : 'ies'} ` +
          `of release packages at another version ${dry ? 'would be ' : ''}dropped, so pnpm resolves ` +
          'them again — ' +
          'including the peers it installed by itself',
      );
      if (dry) for (const key of plan.dropped) say(`    ${key}`);
    }
  }
  const typed = (step: UpgradeStep): string =>
    step.cwd === instanceDir ? step.command : `${step.command}   # in ${step.cwd}`;
  if (dry) {
    say('');
    say('It would then run:');
    steps.forEach((step, index) => say(`  [${String(index + 1)}/${String(steps.length)}] ${typed(step)}   — ${step.purpose}`));
    return { instanceDir, storefrontDir, from, to, upToDate: false, files, steps, exitCode: 0, lines };
  }

  // --- write, then run -------------------------------------------------------
  for (const plan of files) if (plan.after !== plan.before) writeFileSync(plan.file, plan.after, 'utf8');

  const run = options.run ?? spawnStep;
  for (const [index, step] of steps.entries()) {
    say('');
    say(`[${String(index + 1)}/${String(steps.length)}] ${typed(step)}`);
    say(`      ${step.purpose}`);
    const code = await run(step);
    if (code !== 0) {
      say('');
      say(`${step.command} failed (exit ${String(code)}). Remaining steps, in order:`);
      for (const rest of steps.slice(index)) say(`  cd ${rest.cwd} && ${rest.command}`);
      say(
        `The manifests already name ${to}, so \`endora upgrade ${to}\` run again does the same, ` +
          'from the install on.',
      );
      return { instanceDir, storefrontDir, from, to, upToDate: false, files, steps, exitCode: code, lines };
    }
  }

  say('');
  say(`Upgraded to ${to}. Restart what was running from the old release:`);
  say(`  cd ${instanceDir} && pnpm run start   # the API — and its queue consumers, wherever they run`);
  say('  `setup` rebuilt the admin bundle; serve the new one (`pnpm run preview:admin`, or deploy it)');
  if (storefrontDir !== null) {
    say(`  cd ${storefrontDir} && pnpm run build && pnpm run start   # the storefront, built on ${to}`);
  }
  return { instanceDir, storefrontDir, from, to, upToDate: false, files, steps, exitCode: 0, lines };
}

function refusal(reasons: readonly string[]): UpgradeInputError {
  return new UpgradeInputError(
    reasons.length === 1
      ? `${reasons[0]!} Nothing was written.`
      : `\`endora upgrade\` cannot run yet — ${String(reasons.length)} things to settle first:\n` +
          reasons.map((reason) => `  - ${reason}`).join('\n') +
          '\n\nNothing was written.',
  );
}
