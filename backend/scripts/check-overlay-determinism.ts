#!/usr/bin/env tsx
// Git-free determinism gate for every generated artifact (feature 057,
// FR-006/SC-003). Renders the composer, the manifest index, the two `db/`
// registries and every override manifest — bare core plus one per deployment
// under `src/apps/` — in-process and compares them to the committed files on
// disk. Fails if any drifted: identical inputs MUST produce the identical
// committed artifact.
//
// Deliberately does NOT shell out to `git` (the CI `node:*-slim` image has no
// git) and does NOT write the files — it only reads + compares.
//
// ## The fourth verdict: `foreign` (feature 080, T030a; D-155.6)
//
// Determinism is not the only property a committed artefact has to have.
// Feature 080's P3 is option A — packages are discovered at **runtime** and
// contribute nothing to these four files (D-119, confirmed by D-155) — and that
// blindness is correct: an artefact whose content depended on which packages an
// instance happened to install is one nobody could use to detect a genuinely
// stale one, which is `overlay-runtime.ts`'s issue #120 argument one axis out.
//
// But the blindness makes a second claim load-bearing, and nothing watched it:
// that the generator **cannot see a package at all**. Today that rests on one
// string comparison — `readSourceTree`'s `name === 'node_modules'` skip
// (`generate-composer.ts`) — and two scheduled changes aim straight at it.
// **D-146** re-roots every walk onto a module-root list that includes the
// package tree; **D-141** puts module packages at `packages/modules/<id>/`,
// which pnpm symlinks into `node_modules`. If a packaged module's entity is
// ever baked into the committed registry *and* resolved again by the runtime
// loader, it is registered twice — and this check reports every artefact
// deterministic, **because both renders of a wrong generator agree**. That is
// the `empty` verdict's own argument ("two empty strings compare equal") one
// level up.
//
// So every entry in every rendered artefact must land somewhere the committed
// artefact is permitted to cover: the **core tree**, or (per **D-149**, which
// emits a bare specifier for a packaged module) one of this repository's own
// **workspace** packages — and **under no installed package**.
//
// ### What the discriminator can and cannot see
//
// pnpm links a workspace member into `node_modules` too, so "the path goes
// through `node_modules`" answers neither half. The discriminator is therefore
// **the real path**: a specifier is resolved, every symlink on it is followed
// (`fs.realpath`, from the longest existing prefix, so a `.js` specifier over a
// `.ts` file still resolves its directory), and the result is compared with the
// workspace member directories `pnpm-workspace.yaml` globs. A workspace
// member's real path **is** its source directory in this repository; an
// installed package's real path is under `node_modules/.pnpm/…`. That is the
// whole of it, and it is why the `node_modules` segment test alone would be
// wrong in both directions.
//
// **The workspace file is the authority, and `tsconfig.base.json` is not.**
// Membership could be read off the `paths` block instead, and that list is
// hand-written: issue #255 found `@endora-commerce/page-builder-core` missing from it long
// enough for one run to type-check against one branch and execute against
// another. A derivation off the globs cannot acquire that gap, and it also
// means a **bare specifier naming a member is answered without resolving
// anything** — which matters, because a workspace link is *relative*
// (`backend/node_modules/@endora-commerce/contracts -> ../../../packages/contracts`), so a
// `node_modules` wired to another checkout re-roots it silently. A committed
// artefact is a fact about *this* tree, so it is answered from this tree's
// declaration rather than from whatever an instance's links happen to land on.
//
// It **cannot** see: a package vendored by hand *into* a workspace directory
// (it reads as a workspace member — the globs are the authority, not the
// registry); a `pnpm-workspace.yaml` written in flow style (`packages: [a, b]`),
// which this parser reads as no member at all and which is refused as a vacuous
// run rather than passed; a specifier the emitter builds at runtime rather than
// writing as a literal, since the analysis reads the rendered text; a member
// consumed one day as a **published version** rather than a `link:` — the
// remedy then is the lockfile's specifier, not a wider containment test, which
// is the same conclusion `scripts/workspace-resolution.ts` reaches about its
// own question; and it does not ask whether the file at the end of a relative
// specifier **exists** — containment is a property of where an entry lands, and
// existence is the compiler's question and the registry round-trip tests'.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deploymentsOnDisk } from '../src/overlay/overlay-roots.js';
import {
  overrideManifestOutputPath,
  renderOverrideManifest,
} from './generate-override-manifest.js';
import { generatedArtifactPaths, renderAll } from './generate-composer.js';
import { reportReadSize } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Why an artifact failed, or `null` when it is byte-identical to the committed file. */
export type ArtifactVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'stale' | 'empty' | 'foreign';
      readonly detail: string;
    };

/**
 * Compare one rendered artifact with the file on disk.
 *
 * Reading is injected so this can be driven red on inputs the repository does
 * not contain — a stale file, a deleted one, and a generator that rendered
 * nothing. The last is not hypothetical politeness: two empty strings compare
 * equal, so a generator whose tree walk silently found no module would report
 * every artifact deterministic and up to date. That is the vacuous pass this
 * check refuses (issue #113); it reports it as a verdict rather than exiting,
 * because `main` owns the exit code for every artifact it checks.
 */
export function compareArtifact(
  outputPath: string,
  expected: string,
  read: (p: string) => string,
): ArtifactVerdict {
  if (expected.trim().length === 0) {
    return { ok: false, reason: 'empty', detail: 'the generator rendered an empty artifact' };
  }
  let onDisk: string;
  try {
    onDisk = read(outputPath);
  } catch {
    return { ok: false, reason: 'missing', detail: `committed file missing at ${outputPath}` };
  }
  if (onDisk !== expected) {
    return { ok: false, reason: 'stale', detail: `committed file is STALE at ${outputPath}` };
  }
  return { ok: true };
}

// --- containment: where an entry lands (T030a) -----------------------------

/** One package this repository owns, as `pnpm-workspace.yaml` globs it. */
export interface WorkspacePackage {
  /** The `name` in its `package.json`. */
  readonly name: string;
  /** Its directory, real path. */
  readonly dir: string;
}

/** Where a committed artefact's entries are permitted to land. */
export interface PermittedRoots {
  readonly repoRoot: string;
  /** The core source tree — `backend/src`. */
  readonly coreRoot: string;
  readonly workspacePackages: readonly WorkspacePackage[];
}

/** What an entry turned out to be. `foreign` is the finding. */
export type ContainmentVerdict = 'core' | 'workspace-package' | 'foreign';

/** One import specifier in a rendered artefact, and where it actually lands. */
export interface ContainmentSite {
  /** The artefact the specifier was read from. */
  readonly artifact: string;
  readonly specifier: string;
  /** The real path it resolves to, as far as the resolution got. */
  readonly resolved: string;
  readonly verdict: ContainmentVerdict;
  /** Printed beside a finding, and beside a pass while `--why` is not a thing here. */
  readonly detail: string;
}

/** One artefact, byte-compared and contained-checked in one pass. */
export interface ArtifactExamination {
  readonly outputPath: string;
  readonly verdict: ArtifactVerdict;
  readonly sites: readonly ContainmentSite[];
  /**
   * Import lines whose specifier the parser could not read. Not a finding about
   * the tree — a statement that this run cannot answer for that entry, which is
   * why it refuses instead of reporting a pass.
   */
  readonly unreadable: readonly string[];
}

function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function hasNodeModulesSegment(path: string): boolean {
  return path.split(sep).includes('node_modules');
}

/**
 * `fs.realpath` of the longest existing prefix, with the rest appended.
 *
 * A specifier names a `.js` file over a `.ts` source, so realpath of the leaf
 * almost always fails; the **directory** above it is what carries a symlink out
 * of the tree, and that is the hop this has to follow. Resolving the leaf and
 * giving up would make a symlinked module directory read as contained.
 */
function realPathOfNearestExisting(path: string): string {
  const tail: string[] = [];
  let cursor = path;
  for (;;) {
    try {
      return join(realpathSync(cursor), ...tail.reverse());
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return path;
      tail.push(basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Every package this repository owns, from its own workspace declaration.
 *
 * The workspace file is the authority rather than `node_modules`, so a member
 * that is declared and not installed is still a member: the artefact is
 * committed, and what it may contain is a fact about the tree, not about
 * whether somebody has run `pnpm install`.
 */
export function deriveWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  return workspaceMembers(repoRoot, nodeWorkspaceFs())
    .map((member) => ({ name: member.name, dir: realPathOfNearestExisting(member.dir) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The roots a committed artefact may cover.
 *
 * `repoRoot` drives the workspace derivation only; the core tree is this
 * script's own `../src`, so a check run from a moved tree follows the tree
 * rather than a path written down (D-100).
 */
export function permittedRoots(repoRoot: string = resolve(here, '..', '..')): PermittedRoots {
  return {
    repoRoot: resolve(repoRoot),
    coreRoot: resolve(here, '..', 'src'),
    workspacePackages: deriveWorkspacePackages(resolve(repoRoot)),
  };
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

/** Node's own package lookup: `node_modules/<name>` upwards from `fromDir`. */
function resolvePackageDirectory(fromDir: string, name: string): string | null {
  let cursor = resolve(fromDir);
  for (;;) {
    const candidate = join(cursor, 'node_modules', name);
    if (existsSync(candidate)) return realPathOfNearestExisting(candidate);
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function classifyResolvedPath(
  artifact: string,
  specifier: string,
  real: string,
  roots: PermittedRoots,
): ContainmentSite {
  const site = { artifact, specifier, resolved: real };
  if (hasNodeModulesSegment(real)) {
    return {
      ...site,
      verdict: 'foreign',
      detail:
        `resolves to ${real}, which is inside node_modules — an installed package ` +
        'contributes to the running platform at runtime (D-119/D-155) and must not be ' +
        'baked into a committed artefact, or it is registered twice',
    };
  }
  if (isUnder(real, roots.coreRoot)) {
    return { ...site, verdict: 'core', detail: `in the core tree at ${real}` };
  }
  const member = roots.workspacePackages.find((pkg) => isUnder(real, pkg.dir));
  if (member !== undefined) {
    return {
      ...site,
      verdict: 'workspace-package',
      detail: `in the workspace package '${member.name}' at ${real}`,
    };
  }
  return {
    ...site,
    verdict: 'foreign',
    detail:
      `resolves to ${real}, which is outside the core tree and outside every workspace ` +
      'package this repository declares',
  };
}

/** Where one specifier in a rendered artefact lands. */
export function classifySpecifier(
  artifact: string,
  specifier: string,
  roots: PermittedRoots,
): ContainmentSite {
  const fromDir = dirname(artifact);
  if (specifier.startsWith('.')) {
    return classifyResolvedPath(
      artifact,
      specifier,
      realPathOfNearestExisting(resolve(fromDir, specifier)),
      roots,
    );
  }
  const name = packageNameOf(specifier);
  const member = roots.workspacePackages.find((pkg) => pkg.name === name);
  if (member !== undefined) {
    // D-149's own shape: a workspace module package is committed with a bare
    // specifier, and the workspace declaration answers for it without an
    // install having happened — and without following a link, which is what
    // keeps this answer stable in a `git worktree` whose `node_modules` was
    // wired to another checkout (issue #255).
    return {
      artifact,
      specifier,
      resolved: member.dir,
      verdict: 'workspace-package',
      detail: `the workspace package '${member.name}' at ${member.dir}`,
    };
  }
  const packageDir = resolvePackageDirectory(fromDir, name);
  if (packageDir === null) {
    return {
      artifact,
      specifier,
      resolved: name,
      verdict: 'foreign',
      detail:
        `names '${name}', which is no workspace package and resolves to no package on ` +
        'disk — an entry the committed artefact cannot resolve is contained by nothing',
    };
  }
  return classifyResolvedPath(artifact, specifier, packageDir, roots);
}

/** Every `import`/`export … from '<specifier>'` the rendered artefact writes. */
const SPECIFIER_LINE = /^\s*(?:import|export)\b[^;]*?\bfrom\s*'([^']+)'/;
const BARE_IMPORT_LINE = /^\s*import\s*'([^']+)'/;

function specifierOf(line: string): string | null {
  return (SPECIFIER_LINE.exec(line) ?? BARE_IMPORT_LINE.exec(line))?.[1] ?? null;
}

/**
 * Import lines this parser could not read a specifier out of.
 *
 * The generators emit one import per line, so this is empty on every artefact
 * the repository ships — and that is exactly why it is checked rather than
 * assumed. A multi-line import, or any other shape a future emitter grows,
 * would otherwise be silently absent from the population and the run would
 * report containment over the entries it happened to understand.
 */
export function unreadableEntryLines(content: string): string[] {
  return content.split('\n').filter((line) => {
    if (specifierOf(line) !== null) return false;
    if (/^\s*import\b/.test(line)) return true;
    return /^\s*export\b/.test(line) && /\bfrom\b/.test(line);
  });
}

/** Where every entry in one rendered artefact lands. */
export function containmentSites(
  outputPath: string,
  content: string,
  roots: PermittedRoots,
): ContainmentSite[] {
  return content
    .split('\n')
    .map(specifierOf)
    .filter((specifier): specifier is string => specifier !== null)
    .map((specifier) => classifySpecifier(outputPath, specifier, roots));
}

/**
 * One artefact: the byte comparison and the containment question together.
 *
 * `foreign` outranks `missing` and `stale` because of what each tells the
 * author to do. The remedy for a stale artefact is "regenerate and commit" —
 * and regenerating an artefact whose render holds a leak commits the leak. It
 * does not outrank `empty`: a generator that rendered nothing has no entries to
 * contain, and "the walk found no module" is the more useful sentence.
 */
export function examineArtifact(
  outputPath: string,
  expected: string,
  read: (p: string) => string,
  roots: PermittedRoots,
): ArtifactExamination {
  const bytes = compareArtifact(outputPath, expected, read);
  const sites = containmentSites(outputPath, expected, roots);
  const unreadable = unreadableEntryLines(expected);
  const foreign = sites.filter((site) => site.verdict === 'foreign');
  const emptyRender = !bytes.ok && bytes.reason === 'empty';
  const verdict: ArtifactVerdict =
    !emptyRender && foreign.length > 0
      ? {
          ok: false,
          reason: 'foreign',
          detail:
            (foreign.length === 1
              ? '1 entry resolves outside the roots this artefact may cover:\n'
              : `${foreign.length} entries resolve outside the roots this artefact may cover:\n`) +
            foreign.map((site) => `    ${site.specifier} — ${site.detail}`).join('\n'),
        }
      : bytes;
  return { outputPath, verdict, sites, unreadable };
}

/**
 * Why this run may not report on containment at all, or `null`.
 *
 * Issue #113's floor, over the population this verdict actually has. The green
 * that must be impossible is "every artefact is contained" printed by a run
 * that classified no entry — and issue #215's half applies to it too: an
 * artefact that contributed nothing while the others contributed hundreds is a
 * population that came back **short**, not empty, and the totals would hide it.
 * So the floor is per artefact, derived from the artefacts examined rather than
 * from a count written down (D-100).
 */
export function vacuousContainmentPopulation(
  examined: readonly ArtifactExamination[],
  roots: PermittedRoots,
): string | null {
  if (examined.length === 0) {
    return 'no artefact was examined, so containment was decided over nothing';
  }
  if (roots.workspacePackages.length === 0) {
    return (
      'the workspace derivation named no package, so a workspace module package and an ' +
      'installed one are indistinguishable to this run — every bare specifier would read ' +
      'as foreign, and that is a red this run cannot justify. Check pnpm-workspace.yaml.'
    );
  }
  for (const artifact of examined) {
    if (artifact.unreadable.length > 0) {
      return (
        `${artifact.outputPath} holds ${artifact.unreadable.length} import line(s) this ` +
        `check could not read a specifier out of, starting with: ` +
        `${artifact.unreadable[0]!.trim()}. An entry it cannot see is an entry it reports ` +
        'nothing about.'
      );
    }
  }
  for (const artifact of examined) {
    if (artifact.sites.length === 0) {
      return (
        `${artifact.outputPath} contributed no entry to the containment population — the ` +
        'artefact holds no import this check could see, so "contained" over it means ' +
        'nothing'
      );
    }
  }
  return null;
}

/** The remedy for a leaked entry, which is never "regenerate and commit". */
const FOREIGN_REMEDY =
  `  A committed artefact may only carry the core tree and this repository's own\n` +
  `  workspace packages (D-149). An installed package is discovered at runtime\n` +
  `  (D-119/D-155) and contributes to no committed artefact, so this is a walk that\n` +
  `  reached out of the tree — widen the walk's exclusion, not this check:\n` +
  `    backend/scripts/generate-composer.ts (readSourceTree)\n`;

function check(
  label: string,
  outputPath: string,
  expected: string,
  roots: PermittedRoots,
  regenerate?: string,
): ArtifactExamination {
  const examined = examineArtifact(outputPath, expected, (p) => readFileSync(p, 'utf8'), roots);
  if (examined.verdict.ok) {
    process.stdout.write(`[overlay:check] ${label}: up-to-date and deterministic ✓\n`);
    return examined;
  }
  process.stderr.write(`[overlay:check] ${label}: ${examined.verdict.detail}\n`);
  process.stderr.write(
    examined.verdict.reason === 'foreign'
      ? FOREIGN_REMEDY
      : `  Regenerate and commit:\n` +
          (regenerate ??
            `    pnpm --filter backend run overlay:manifest\n` +
              `    pnpm --filter backend run composer:generate\n`),
  );
  return examined;
}

/**
 * The override manifests this check compares: bare core, plus one per deployment
 * shipped under `src/apps/`.
 *
 * Env-independent on purpose. The manifest is the committed audit record of a
 * deployment's divergence from core (feature 057, FR-005 — reviewers read it in
 * the MR diff), and every deployment's lives at its own path, so there is no
 * reason for `DEPLOYMENT` to decide which of them the gate looks at. It used to,
 * and the consequence was `example`'s artefact being uncommitted and its line
 * reporting `missing` on every run that set the variable while no run that left
 * it unset looked at the artefact at all (issue #120).
 */
function overrideManifestTargets(): ReadonlyArray<string | null> {
  return [null, ...deploymentsOnDisk()];
}

function overrideManifestLabel(deployment: string | null): string {
  return `override-manifest (${deployment ?? 'core'})`;
}

function overrideManifestRegenerateHint(deployment: string | null): string {
  return deployment === null
    ? '    pnpm --filter backend run overlay:manifest\n'
    : `    DEPLOYMENT=${deployment} pnpm --filter backend run overlay:manifest\n`;
}

/**
 * Every committed artefact this check covers, by output path.
 *
 * Exported without rendering anything so a test can compare it against the
 * `*.generated.ts` files actually on disk: an artefact no determinism gate
 * looks at is one that drifts unnoticed, which is the failure this check
 * exists for.
 */
export function coveredArtifactPaths(): readonly string[] {
  return [
    ...generatedArtifactPaths(),
    ...overrideManifestTargets().map(overrideManifestOutputPath),
  ];
}

async function main(): Promise<void> {
  const roots = permittedRoots();
  // Feature 072 — the composer and the manifest registry are generated from the
  // same tree walk and committed the same way, so they are checked here rather
  // than in a second script with the same shape. Feature 071's F2 added the two
  // `db/` registries to that same walk, for the same reason.
  const examined = [
    ...(await renderAll()).map((artifact) =>
      check(artifact.label, artifact.outputPath, artifact.content, roots),
    ),
    ...overrideManifestTargets().map((deployment) => {
      const rendered = renderOverrideManifest(
        deployment === null ? {} : ({ DEPLOYMENT: deployment } as NodeJS.ProcessEnv),
      );
      return check(
        overrideManifestLabel(deployment),
        rendered.outputPath,
        rendered.content,
        roots,
        overrideManifestRegenerateHint(deployment),
      );
    }),
  ];
  // The containment floor before the read line, because both exit 2 and this
  // one names the artefact (issue #113, and #215's short-walk half).
  const vacuous = vacuousContainmentPopulation(examined, roots);
  if (vacuous !== null) {
    process.stderr.write(`[overlay:check] ${vacuous}\n`);
    process.exit(2);
  }
  // What was read, beside what was found (issue #244). `files` is the committed
  // artefacts compared, and it is the number that moves when a deployment stops
  // being discovered under `src/apps/` — the shape of issue #120, where one
  // deployment's artefact was looked at by no run at all. `sites` is the finer
  // population the `foreign` verdict answers over: every entry in every rendered
  // artefact, contained or not.
  // `self-reported`: the artefact list comes from the generators themselves, and
  // the independent half is `coveredArtifactPaths()` against the `*.generated.ts`
  // files on disk, which is the companion test's assertion rather than a second
  // walk here.
  reportReadSize({
    prefix: '[overlay:check]',
    files: examined.length,
    sites: examined.reduce((total, artifact) => total + artifact.sites.length, 0),
  });
  if (!examined.every((artifact) => artifact.verdict.ok)) process.exit(1);
  process.stdout.write('[overlay:check] all generated artifacts deterministic and contained ✓\n');
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// regenerate every artifact and exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
