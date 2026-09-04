/**
 * CI check — the release-intent gate cannot silently stop asking (feature 080, T043).
 *
 * ## The defect this exists for
 *
 * `release:changeset` runs `changeset status --since=origin/<target>` on every
 * merge request, and D-107 makes that the gate: a branch that changes a package
 * under `packages/` and carries no changeset fails. The gate is the changesets
 * CLI's own command, so there is nothing of *ours* in it to keep correct — which
 * was the stated reason it needed no check of its own, and which is exactly
 * backwards. The CLI is correct. What decides whether it is *looking* is
 * `.changeset/config.json`, and every way that file can be wrong produces
 * **exit 0 with an empty release plan**, which is byte-identical to a clean
 * branch.
 *
 * Measured on this repository, against the real five manifests, with a branch
 * that changes `packages/contracts/src/index.ts` and carries no changeset:
 *
 * ```
 * privatePackages: { version: true,  tag: false }   exit 1   <- the gate
 * privatePackages: { version: false, tag: false }   exit 0   "Packages to be bumped:" (none)
 * privatePackages omitted entirely                  exit 0   "Packages to be bumped:" (none)
 * ```
 *
 * All five packages are `"private": true`, and `@changesets/config@4` defaults
 * `privatePackages` to `false`. So the single most damaging edit anyone can make
 * to the release flow is **deleting four lines of what looks like boilerplate**,
 * and before this file nothing in the repository would have noticed: no test
 * read the config, and an MR that touches only `.changeset/` matches no rung of
 * `.backend-test-rules`, so no suite ran against it either.
 *
 * ## What it refuses
 *
 * Eight findings, each a way the flow goes quiet rather than red. Every one is
 * derived from the tree on every run — the workspace globs, the manifests, the
 * changeset files — because a rule of the form "these four names are the
 * applications" is a derived fact written down (D-100), and the 67-package
 * future of D-160.2 is precisely the moment such a list stops describing the
 * repository.
 *
 *   * `version-disabled` — a versionable member is `"private": true` while
 *     `privatePackages.version` is not `true`. The measurement above.
 *   * `unexpected-public-package` — a versionable member that is not
 *     `"private": true` and is **outside the publication set**. It is the
 *     narrowed survivor of `publishable-package`, which refused every public
 *     member and therefore could not survive the merge request it exists to
 *     force: with three packages published it would fire three times, forever.
 *     The set is derived (feature 104, FR-001) and written down nowhere — see
 *     *The publication set* below.
 *   * `incomplete-public-package` — a public versionable member that declares
 *     no `repository` or no `publishConfig.access`. Fitness to be published,
 *     which is the question `publishable-package` was standing in for.
 *   * `restricted-public-package` — a public versionable member whose effective
 *     access resolves to `restricted`. On npmjs a scoped package is private by
 *     default and a private package needs a paid account, so this is a publish
 *     that fails or a package that is quietly unreachable; GitLab ignores
 *     `--access` entirely, so the rehearsal exercises no access decision and
 *     the value has to be judged statically (feature 104, FR-012).
 *   * `unresolvable-scope` — a public versionable member whose scope the
 *     configured registry cannot serve (feature 104, FR-013). See *The scope*
 *     below: the failure is **silent**, which is why it is a static finding
 *     rather than something a failing install would reveal.
 *   * `tag-policy-unstated` — the total replacement of
 *     `tag-without-publication`. See *Tags* below.
 *   * `ignored-family-member` — an `ignore` pattern matching a package that a
 *     *family* workspace glob produced. This is the 67-package failure mode:
 *     `ignore` is glob-matched against package **names**, so one entry reading
 *     `@endora-commerce/*` would exempt every module package from the gate at
 *     once, and `changeset status` would go on printing a cheerful exit 0.
 *   * `unignored-application` — the same rule pointing the other way: a package
 *     from a *literal* workspace entry that no `ignore` pattern matches. It says
 *     the ignore list is **complete**, not merely safe.
 *   * `stale-ignore-entry` — an `ignore` pattern matching no member at all. A
 *     path written where a name belongs (`packages/*`) matches nothing, and the
 *     entry it replaced stops being ignored — loud for an application, and the
 *     reason `AGENTS.md` says a typo fails safe. It is still a claim about this
 *     repository that this repository no longer contains.
 *   * `stale-group-member` — a `linked` or `fixed` group naming a package that
 *     is not a workspace member. The group silently stops covering it; nothing
 *     else reports that.
 *   * `unversionable-changeset` — a `.changeset/*.md` naming a package that is
 *     ignored, or that is not a member. This is the reconciliation: the
 *     changeset files are written by hand, the classification is derived from
 *     the workspace, and a disagreement between them means somebody's release
 *     intent will be dropped on the floor by `changeset version`.
 *
 * ## The ninth, and the one that needs a diff — `--since <ref>`
 *
 * `changeset status` decides *which* packages a branch changed by asking which
 * package **directory** each changed file sits under. That is right for a
 * package whose sources are its own directory, and it is wrong — silently, and
 * in the dangerous direction — for one whose sources are not.
 *
 * `@endora-commerce/platform` is the case. Its `tsconfig.build.json` sets
 * `rootDir` to `../../backend/src` and includes five directories of it, so
 * `packages/platform/` holds a manifest, two tsconfigs and a README while the
 * code it publishes lives under `backend` — which is in `ignore`. Measured on
 * `origin/feat/080-t042a-host-package`: a commit editing
 * `backend/src/kernel/settings/settings-cache.ts`, compiled straight into the
 * published `dist`, reports `Packages to be bumped:` **empty** and exits 0,
 * while a commit editing `packages/platform/README.md`, which ships in nothing,
 * exits 1. The gate demands a changeset for the changes that cannot reach a
 * consumer and waives it for the changes that can.
 *
 *   * `unattributed-published-change` — this branch changes a file that a
 *     versionable package compiles into its published `dist`, that file is
 *     outside the package's own directory, and the branch adds no changeset.
 *
 * The population is derived from each versionable package's own
 * `tsconfig.build.json` — its `include` and `exclude`, following `extends` —
 * because the answer to *"does this commit change what a package emits?"* is a
 * function of the compilation and not of a directory name, and a second copy of
 * the include list written into a check is the derived fact D-100 forbids.
 *
 * It is the same question the CLI asks, at the CLI's granularity: *did a
 * versionable package change while this branch carries zero changesets*, not
 * *is there a changeset per package*. One rule, one grammar; reviewers close the
 * per-package gap for both halves.
 *
 * This mode needs a git diff, so it runs in `release:changeset` — the one job
 * that installs git and resolves the target branch — rather than in `quality`.
 * The default mode is untouched by it and reads no build configuration at all.
 *
 * ## Family or application, derived
 *
 * `pnpm-workspace.yaml` is the authority and the discriminator is the **shape of
 * the entry**: one containing a glob character enumerates a *family* — a set of
 * libraries whose membership is not known in advance, which is what a library
 * directory is — and a literal entry names one deployable. Today that reads
 * `backend`, `storefront`, `admin`, `docs` as applications and `packages/*` as
 * the family, which is the split `AGENTS.md` states in prose. It costs nothing
 * when 66 module packages arrive under a second scope and a directory deeper:
 * they arrive through a glob, so they are versionable by default and the
 * `ignore` list does not grow.
 *
 * A member matched by both a literal and a family entry counts as **family**.
 * That is the failing-safe direction: a versionable package demands a changeset,
 * and an ignored one demands nothing.
 *
 * ## The publication set — derived, and the reason `publishable-package` had to
 * be narrowed rather than deleted
 *
 * D-203 publishes three packages to a private registry for a deployment. Before
 * that, *any* public versionable member was a finding, which is what forced the
 * publication merge request to be a merge request. After it, the same predicate
 * fires three times on a correct tree, forever — so it has to become a question
 * with a different subject rather than be suppressed (feature 104, FR-010).
 *
 * The subject is **which packages may be public**, and feature 104's FR-001
 * answers it by derivation: the transitive closure, over `dependencies` and
 * `peerDependencies`, of the `@endora-commerce/*` entries the reference
 * storefront declares. `devDependencies` are excluded and the exclusion is
 * load-bearing — `page-builder-admin` dev-depends on five siblings and a
 * consumer installs none of them.
 *
 * Two properties of that derivation are the whole point. It is written down
 * nowhere (D-100): a fourth package entering the storefront's dependencies
 * changes the answer by being added to that manifest and by nothing else. And
 * the reference storefront is itself derived — **the one workspace member that
 * declares `next` and a `build` script that runs it**, which is
 * `new-storefront/reference.ts`' own predicate, imported rather than copied, so
 * the check and the scaffold cannot come to disagree about which application
 * they are talking about. Zero such members, or two, is exit 2 while any
 * versionable member is public: the population is then undecidable, and a check
 * that guessed would license exactly the drive-by publication D-160.5 refuses.
 *
 * ## The scope, and the failure that is silent
 *
 * `contracts/registry-and-scope.md` R2: GitLab's instance-level npm endpoint
 * resolves a scoped package by turning its **scope** into a top-level namespace
 * path (`lib/api/npm_instance_packages.rb` —
 * `Namespace.top_level.by_path(::Packages::Npm.scope_of(name))`). A scope that
 * resolves to no such namespace is **not an error**: the request is forwarded to
 * `registry.npmjs.org` (`npm_package_requests_forwarding`, default on) and the
 * client is told the package is not in the npm registry. Measured — 302, to
 * npmjs, for `@endora-commerce/contracts` before the group existed.
 *
 * So the scope is judged here, statically, because no install will report it:
 * a public package must be **scoped**, its scope must be spellable as a GitLab
 * top-level namespace path, and every public package must share **one** scope —
 * the client holds one `.npmrc` line naming one scope (R3), so a second scope is
 * a package that silently forwards to a registry that does not have it.
 *
 * ## Tags — and why the old rule went quiet through its own repair
 *
 * `tag-without-publication` asked its question under
 * `privateVersionable.length === versionable.length`. The first public package
 * makes that condition false, so the finding stops firing **in both
 * directions** — and nothing else in the repository holds `privatePackages.tag`.
 * That is this estate's own failure, a check that quietly stops asking,
 * arriving through the repair (feature 104, FR-011).
 *
 * `tag-policy-unstated` is therefore **total**: there is no tree, and no value
 * of that field, for which no rule applies.
 *
 *   * **While any versionable package is private**, `tag` must be exactly
 *     `false`. `changeset publish` would otherwise write one ref per private
 *     package per release, naming a version no registry serves — a fact derived
 *     from the commit that wrote it (D-100), written into a ref every clone
 *     fetches. This is the old rule, with its guard widened from *every* to
 *     *any*, which is the direction that keeps it alive in the mixed state.
 *   * **Once no versionable package is private**, the field governs nothing —
 *     `getUntaggedPrivatePackages` is where changesets consults it, and a public
 *     package is git-tagged regardless of it (`@changesets/cli@3.0.1`,
 *     `dist/git-tag.mjs`). An absent field is then the `@changesets/config@4`
 *     default rather than anybody's decision, so it must be **explicitly
 *     present and boolean**: a reader has to be able to tell a policy from a
 *     silence.
 *
 * ## Exit 2 — eight ways it refuses to report on what it did not read
 *
 * A missing or unparseable `.changeset/config.json`; a `pnpm-workspace.yaml`
 * that yields no globs (`workspace-packages.ts` is a block-sequence reader, so a
 * flow-style list reads as none — a refusal, never an empty workspace); no
 * workspace member at all; a non-negated glob that matched no member, which is
 * issue #215's short walk over this population — move `packages/` and the four
 * application manifests still answer every question above; an `ignore` pattern
 * in a grammar richer than `*` and `?`, since micromatch has one and this file
 * does not, and a pattern it cannot read must not be reported as matching
 * nothing; and a `.changeset/` directory this check could not list.
 *
 * Feature 104 adds the two that make the publication set answerable, and both
 * are conditional on a versionable member actually being public — an all-private
 * checkout asks no such question, and refusing there would be a refusal about a
 * population nothing consults. A checkout declaring **no** reference storefront,
 * and one declaring more than one: either way *which packages may be public* has
 * no answer, and reporting a public package as expected — or as unexpected —
 * would be a verdict this run did not measure.
 *
 * `--since` adds four of its own, for the same reason: a versionable package
 * with no readable `tsconfig.build.json`, a build configuration with no
 * `include` at all, an `extends` chain this file cannot follow, and a git
 * invocation that failed. Each of them would otherwise mean "this package
 * publishes nothing outside its own directory", which is the answer that lets
 * the gate stay quiet.
 *
 * ## The empty diff is two facts, and only one of them is a refusal
 *
 * Pipeline 11491 failed a correct merge request. !916 changed three Dockerfiles,
 * a `.dockerignore`, a shell script and a test, and this mode exited 2 on *"the
 * branch changes no file at all"*. It had been **merged** before the job fetched
 * its baseline, so `HEAD` was already an ancestor of `origin/master`.
 *
 * The baseline is not the bug, and it is worth saying plainly because it is the
 * first place anyone looks: the diff has been `${since}...HEAD` since !882, and
 * `git diff A...B` **is** the merge-base diff — a merge request's own diff, and
 * arguably what `--since` always meant. That is exactly why re-baselining
 * repairs nothing here. When the branch has been merged, `merge-base` returns
 * `HEAD`, so the merge base is what produces the empty diff.
 *
 * What separates the two cases is a fact the diff does not carry, and one git
 * command answers it: `git merge-base --is-ancestor HEAD <baseline>`.
 * {@link ReleaseIntentContainment} has the reasoning in full; the short version
 * is that a contained branch adds nothing to the baseline **by construction**,
 * which is a measured verdict, while an empty diff from a real fork point is a
 * measurement that came back empty and stays exit 2.
 *
 * Usage: `tsx scripts/check-release-intent.ts [--root <dir>] [--since <ref>]`
 * Exit 0 = the flow can still go red; 1 = a finding; 2 = it did not read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSizeRefusal, reportReadSize, type ReadCoverage } from './lib/read-size.js';
import {
  classifyWorkspaceMembers,
  isNextApplication,
  nodeWorkspaceFs,
  workspaceGlobs,
  type WorkspaceFs,
} from './lib/workspace-packages.js';

/** The check's log prefix, brackets included. */
export const PREFIX = '[release-intent]';

/** One workspace member, with the workspace entry that produced it. */
export interface ClassifiedMember {
  readonly name: string;
  /** Repository-relative directory, for messages. */
  readonly dir: string;
  /** Whether the manifest declares `"private": true`. */
  readonly isPrivate: boolean;
  /**
   * True when a *glob* workspace entry produced it — a library family. False
   * when every entry that produced it is a literal directory — an application.
   */
  readonly family: boolean;
  /** The workspace entries that matched it, for the message. */
  readonly globs: readonly string[];
  /**
   * Whether the manifest declares a `repository` — a string, or an object with
   * a `url`. npm publishes without one; what is lost is the path from the
   * package page back to the code, and provenance, which npm's own
   * documentation makes conditional on it.
   */
  readonly repository: boolean;
  /** `publishConfig.access`, verbatim, or `null` when it declares none. */
  readonly access: string | null;
  /**
   * The workspace-internal packages this member declares in `dependencies` and
   * `peerDependencies` — the two fields a consumer installs. `devDependencies`
   * are deliberately absent: `page-builder-admin` dev-depends on five siblings
   * and a consumer receives none of them, which is what keeps the publication
   * set at three packages rather than eight.
   */
  readonly runtimeDependencies: readonly string[];
  /**
   * Whether this member is a Next application — the shape the reference
   * storefront has. The predicate is `lib/workspace-packages.ts`', shared with
   * `endora new storefront`, so the two cannot disagree about which application
   * they mean.
   */
  readonly nextApplication: boolean;
}

/**
 * Which packages may be public, and how that was decided.
 *
 * `members` is the transitive closure described in *The publication set* above,
 * or `null` when the reference storefront could not be resolved — in which case
 * `unresolved` says why, and {@link checkReleaseIntent} turns it into a refusal
 * **only** if some versionable member is actually public. An all-private
 * checkout asks no question this answers.
 */
export interface PublicationSet {
  readonly members: readonly string[] | null;
  readonly unresolved: string;
}

/** One `<name>: <bump>` line in the front matter of a `.changeset/*.md`. */
export interface ChangesetRelease {
  /** File name, e.g. `contracts-ships-dist.md`. */
  readonly file: string;
  readonly packageName: string;
  readonly bump: string;
}

/** Everything the analysis reads, in the shape it reads it. */
export interface ReleaseIntentInputs {
  readonly config: Readonly<Record<string, unknown>>;
  readonly members: readonly ClassifiedMember[];
  readonly changesets: readonly ChangesetRelease[];
  /** Non-negated workspace entries, and how many members each produced. */
  readonly globCoverage: ReadonlyMap<string, number>;
  /** Which packages may be public (feature 104, FR-001), or why that is undecidable. */
  readonly publication: PublicationSet;
  /** Files opened, for the read line. */
  readonly files: number;
}

export type ReleaseIntentFindingKind =
  | 'version-disabled'
  | 'unexpected-public-package'
  | 'incomplete-public-package'
  | 'restricted-public-package'
  | 'unresolvable-scope'
  | 'tag-policy-unstated'
  | 'ignored-family-member'
  | 'unignored-application'
  | 'stale-ignore-entry'
  | 'stale-group-member'
  | 'unversionable-changeset'
  | 'unattributed-published-change';

export interface ReleaseIntentFinding {
  readonly kind: ReleaseIntentFindingKind;
  /** The package name, pattern or setting the finding is about. */
  readonly subject: string;
  readonly message: string;
}

/** Why this run may not report a verdict. Distinct from "no findings". */
export interface ReleaseIntentRefusal {
  readonly reason: string;
}

export interface ReleaseIntentResult {
  readonly findings: readonly ReleaseIntentFinding[];
  readonly inputs: ReleaseIntentInputs;
  /** Decisions taken inside the files, for the read line. */
  readonly sites: number;
  readonly coverage: readonly ReadCoverage[];
}

// --- reading ---------------------------------------------------------------

/**
 * Micromatch constructs this file does not implement — a character class, a
 * brace expansion, an alternation, a leading negation, and the five extglob
 * heads, each of which is a metacharacter **only** when a `(` follows it.
 *
 * That last distinction is load-bearing rather than pedantic. `@` and `+` are
 * ordinary characters in a package name: `@endora-commerce/*` is the pattern
 * the 67-package future would be exempted by, and a reader that refused it
 * would turn this check's most valuable finding — `ignored-family-member` —
 * into an exit 2 that an author clears by deleting the check from the job.
 */
const UNREADABLE_CONSTRUCT = /[[\]{}|]|^!|[?*+@!]\(/;

/**
 * Whether `name` matches an `ignore` pattern.
 *
 * `*` spans any run of characters including `/`, because the thing being matched
 * is a package **name** and a scope separator is not a path separator. `?` is
 * one character. Everything richer belongs to micromatch and is refused by
 * {@link unreadablePattern} before this is called — a pattern this file cannot
 * read must not be reported as matching nothing, which would turn an ignored
 * application into an `unignored-application` finding and an over-broad
 * `@scope/*` into silence.
 */
export function matchesPattern(pattern: string, name: string): boolean {
  const source = pattern
    .split(/([*?])/)
    .map((part) => (part === '*' ? '.*' : part === '?' ? '.' : escapeRegExp(part)))
    .join('');
  return new RegExp(`^${source}$`).test(name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first `ignore` pattern this file cannot read, or `null`. */
export function unreadablePattern(patterns: readonly string[]): string | null {
  return patterns.find((pattern) => UNREADABLE_CONSTRUCT.test(pattern)) ?? null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Every package name named by a `linked` or `fixed` group. */
export function groupMembers(config: Readonly<Record<string, unknown>>): readonly string[] {
  const groups = [config['linked'], config['fixed']].flatMap((value) =>
    Array.isArray(value) ? (value as unknown[]) : [],
  );
  return groups.flatMap((group) => stringList(group));
}

/**
 * The `<name>: <bump>` lines of one changeset's YAML front matter.
 *
 * Deliberately a reader of the front matter rather than of the whole document:
 * the summary below it is prose and may quote anything, including a package
 * name and a colon.
 */
export function parseChangeset(file: string, source: string): readonly ChangesetRelease[] {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (match === null) return [];
  const releases: ChangesetRelease[] = [];
  for (const line of (match[1] ?? '').split('\n')) {
    const entry = /^\s*(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(\S+)\s*$/.exec(line);
    if (entry === null) continue;
    const packageName = entry[1] ?? entry[2] ?? entry[3];
    const bump = entry[4];
    if (packageName === undefined || bump === undefined) continue;
    releases.push({ file, packageName, bump });
  }
  return releases;
}

/** Whether a manifest declares a `repository` — a string, or an object with a `url`. */
export function declaresRepository(manifest: Readonly<Record<string, unknown>>): boolean {
  const repository = manifest['repository'];
  if (typeof repository === 'string') return repository.trim().length > 0;
  if (typeof repository !== 'object' || repository === null || Array.isArray(repository)) {
    return false;
  }
  const url = (repository as Record<string, unknown>)['url'];
  return typeof url === 'string' && url.trim().length > 0;
}

/** `publishConfig.access` as the manifest writes it, or `null`. */
export function publishConfigAccess(
  manifest: Readonly<Record<string, unknown>>,
): string | null {
  const publishConfig = manifest['publishConfig'];
  if (typeof publishConfig !== 'object' || publishConfig === null || Array.isArray(publishConfig)) {
    return null;
  }
  const access = (publishConfig as Record<string, unknown>)['access'];
  return typeof access === 'string' ? access : null;
}

/** The package names one dependency field of a manifest declares. */
function dependencyNames(
  manifest: Readonly<Record<string, unknown>>,
  field: string,
): readonly string[] {
  const declared = manifest[field];
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return [];
  return Object.keys(declared as Record<string, unknown>);
}

/**
 * Which packages may be public — the closure of {@link ClassifiedMember} names
 * reachable from the reference storefront over `dependencies` and
 * `peerDependencies` (feature 104, FR-001).
 *
 * Nothing here names a package, a scope or a directory: the reference storefront
 * is *the* Next application among the members, and the set is what its manifest
 * reaches. A fourth package entering the storefront's dependencies changes the
 * answer by being added to that manifest and by nothing else (R1.1), and a
 * repository with no such application — or two of them — gets no answer at all
 * rather than a guess.
 */
export function publicationSet(members: readonly ClassifiedMember[]): PublicationSet {
  const applications = members.filter((member) => member.nextApplication);
  if (applications.length === 0) {
    return {
      members: null,
      unresolved:
        'no workspace member is a Next application, so this checkout declares no reference ' +
        'storefront and there is nothing to derive the publication set from (feature 104, ' +
        'FR-001: the set is the closure of that application\'s workspace dependencies, and is ' +
        'written down nowhere)',
    };
  }
  if (applications.length > 1) {
    return {
      members: null,
      unresolved:
        `${String(applications.length)} workspace members are Next applications ` +
        `(${applications.map((member) => member.dir).join(', ')}), so which one is the ` +
        'reference storefront — and therefore which packages may be public — is a question ' +
        'this run cannot answer. Taking whichever sorted first would be a population nobody chose',
    };
  }

  const byName = new Map(members.map((member) => [member.name, member] as const));
  const reached = new Set<string>();
  const queue = [...applications[0]!.runtimeDependencies];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const member = byName.get(name);
    // Third-party dependencies are not workspace members and end the walk;
    // the closure is over packages this repository could publish.
    if (member === undefined || reached.has(name)) continue;
    reached.add(name);
    queue.push(...member.runtimeDependencies);
  }
  return { members: [...reached].sort(), unresolved: '' };
}

/**
 * Read the whole release-intent configuration off a checkout.
 *
 * Takes a {@link WorkspaceFs} so a red proof can hand in a synthetic repository
 * at the top of the analysis (issue #130) rather than a half-classified record
 * at the bottom of it. `listChangesets` is separate because `WorkspaceFs` lists
 * directories and not files.
 */
export function readReleaseIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
): ReleaseIntentInputs | ReleaseIntentRefusal {
  const configText = fs.readText(join(repoRoot, '.changeset', 'config.json'));
  if (configText === null) {
    return { reason: '`.changeset/config.json` is missing — there is no release intent to read' };
  }
  let config: unknown;
  try {
    config = JSON.parse(configText) as unknown;
  } catch (error) {
    return { reason: `\`.changeset/config.json\` does not parse: ${String(error)}` };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { reason: '`.changeset/config.json` is not an object' };
  }

  const globs = workspaceGlobs(repoRoot, fs).filter((glob) => !glob.startsWith('!'));
  if (globs.length === 0) {
    return {
      reason:
        '`pnpm-workspace.yaml` yielded no `packages:` entries — a flow-style list reads as ' +
        'none, and an empty workspace would make every question below vacuous',
    };
  }

  // The family/application split is `lib/workspace-packages.ts`' derivation and
  // no longer this check's own: `test/unit/packages/package-dist-build.test.ts`
  // asks the same question of the same members — *"is this a library we publish
  // or an application we deploy?"* — and a second answer to it is two answers
  // waiting to disagree about the package that arrives next.
  const { members, globCoverage } = classifyWorkspaceMembers(repoRoot, fs);
  if (members.length === 0) {
    return { reason: 'the workspace globs matched no package at all' };
  }

  const classified: ClassifiedMember[] = members.map((member) => ({
    name: member.name,
    dir: member.dir.startsWith(repoRoot) ? member.dir.slice(repoRoot.length + 1) : member.dir,
    isPrivate: member.manifest['private'] === true,
    family: member.family,
    globs: member.globs,
    repository: declaresRepository(member.manifest),
    access: publishConfigAccess(member.manifest),
    runtimeDependencies: [
      ...dependencyNames(member.manifest, 'dependencies'),
      ...dependencyNames(member.manifest, 'peerDependencies'),
    ],
    nextApplication: isNextApplication(member.manifest),
  }));

  const changesetDir = join(repoRoot, '.changeset');
  const entries = listChangesets(changesetDir);
  if (entries === null) {
    return { reason: '`.changeset/` could not be listed' };
  }
  const changesetFiles = entries.filter(
    (name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md',
  );
  const changesets = changesetFiles.flatMap((name) =>
    parseChangeset(name, fs.readText(join(changesetDir, name)) ?? ''),
  );

  return {
    config: config as Record<string, unknown>,
    members: classified,
    changesets,
    globCoverage,
    publication: publicationSet(classified),
    // config.json + pnpm-workspace.yaml + one manifest per member. What the
    // walk *opened*, never what it found in.
    //
    // **The changesets are read and deliberately not counted here**, and the
    // reason is what `files` is for. It is the vacuous-pass floor: a green
    // result must not be able to mean "nothing was read". For this check that
    // means the workspace manifests and the config — without them every
    // predicate is vacuously true. The changeset files are the *subject* of one
    // question rather than the population of the analysis, their count is
    // already printed beside it as `changesets=`, and **zero of them is a
    // legitimate state** — a freshly released tree has none.
    //
    // Folding them in made the counted population oscillate with the release
    // cycle rather than with the tree, so no single recorded band could bound
    // it: at 30 pending changesets `files` sat exactly on the +50% ceiling and
    // the next merge request to add one failed, while a release consuming them
    // would have dropped it under the −10% floor in the same week. Measured on
    // `a059e56e`: 51 with them, 17 without.
    files: 2 + members.length,
  };
}

/**
 * GitLab's top-level reserved routes, the ones a package scope could plausibly
 * be. From `lib/gitlab/path_regex.rb` (`TOP_LEVEL_ROUTES`), which is GitLab's
 * own constant and not a fact about this repository — a namespace cannot be
 * created at any of these paths, so a scope spelling one can never resolve.
 *
 * It is deliberately not the whole list: the entries omitted are ones no scope
 * would be, and a missing entry fails in the direction the tree is in already —
 * the silent forward this finding exists to describe — rather than as a false
 * red on a legitimate scope.
 */
const GITLAB_RESERVED_PATHS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'assets',
  'dashboard',
  'explore',
  'files',
  'groups',
  'health_check',
  'help',
  'import',
  'jwt',
  'login',
  'oauth',
  'profile',
  'projects',
  'public',
  'robots.txt',
  's',
  'search',
  'sitemap',
  'snippets',
  'unsubscribes',
  'uploads',
  'users',
  'v2',
]);

/** The scope of a package name — `@fx/alpha` → `fx` — or `null` when unscoped. */
export function scopeOf(name: string): string | null {
  const match = /^@([^/]+)\//.exec(name);
  return match === null ? null : match[1]!;
}

/**
 * Why a GitLab instance-level npm endpoint cannot serve this package, or `null`.
 *
 * A sentence rather than a boolean, because the three ways it fails have
 * nothing in common for the reader: no scope at all, a scope that is not a legal
 * namespace path, and a scope at a path GitLab reserves for itself.
 */
export function unservableScope(name: string): string | null {
  const scope = scopeOf(name);
  if (scope === null) {
    return (
      'is unscoped, so there is no scope for the endpoint to turn into a namespace path — ' +
      '`Packages::Npm.scope_of` answers nothing and the lookup never happens.'
    );
  }
  if (!/^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_-])?$/.test(scope)) {
    return (
      `is scoped \`@${scope}\`, which is not spellable as a GitLab namespace path (a path ` +
      'starts with a letter, a digit or `_`, carries only letters, digits, `_`, `-` and `.`, ' +
      'and does not end in a dot).'
    );
  }
  if (/\.(?:git|atom)$/.test(scope)) {
    return `is scoped \`@${scope}\`, and GitLab reserves the \`.git\` and \`.atom\` suffixes.`;
  }
  if (GITLAB_RESERVED_PATHS.has(scope)) {
    return (
      `is scoped \`@${scope}\`, which is one of GitLab's reserved top-level routes ` +
      '(`lib/gitlab/path_regex.rb`), so no namespace can exist at that path.'
    );
  }
  return null;
}

// --- analysis --------------------------------------------------------------

/**
 * Every way this configuration would let the gate go quiet.
 *
 * Pure over the record {@link readReleaseIntent} produces, so the CLI and a red
 * proof run the same predicates over the same shape.
 */
export function analyzeReleaseIntent(inputs: ReleaseIntentInputs): readonly ReleaseIntentFinding[] {
  const findings: ReleaseIntentFinding[] = [];
  const ignorePatterns = stringList(inputs.config['ignore']);
  const isIgnored = (name: string): boolean =>
    ignorePatterns.some((pattern) => matchesPattern(pattern, name));

  const versionable = inputs.members.filter((member) => member.family);
  const privateVersionable = versionable.filter((member) => member.isPrivate);

  const privatePackages = inputs.config['privatePackages'];
  const settings =
    typeof privatePackages === 'object' && privatePackages !== null && !Array.isArray(privatePackages)
      ? (privatePackages as Record<string, unknown>)
      : {};

  // 1 — the four lines that look like boilerplate.
  if (privateVersionable.length > 0 && settings['version'] !== true) {
    findings.push({
      kind: 'version-disabled',
      subject: 'privatePackages.version',
      message:
        `is ${JSON.stringify(settings['version'] ?? null)} while ${privateVersionable.length} ` +
        'versionable package(s) are `"private": true`. `@changesets/config@4` defaults it to ' +
        '`false`, and with it false every changesets command — `status`, `version`, and the ' +
        '`release:changeset` gate — reports a cheerful nothing and exits 0. Set it to `true`.',
    });
  }

  // 2 — publication, and whether each public package is fit for it (feature 104).
  const publicVersionable = versionable.filter((member) => !member.isPrivate);
  const publishable = inputs.publication.members;
  const configAccess = typeof inputs.config['access'] === 'string' ? inputs.config['access'] : null;

  for (const member of publicVersionable) {
    // 2a — D-160.5, narrowed: the question is no longer "is it public" (which
    // three correct packages now answer yes to, forever) but "may it be".
    if (publishable !== null && !publishable.includes(member.name)) {
      findings.push({
        kind: 'unexpected-public-package',
        subject: member.name,
        message:
          `(${member.dir}) is not \`"private": true\` and is outside the publication set. That ` +
          'set is derived, never listed (feature 104, FR-001): it is the closure of the ' +
          'reference storefront\'s `dependencies` and `peerDependencies` over the workspace, ' +
          `which today reaches ${publishable.length > 0 ? publishable.join(', ') : 'nothing'}. ` +
          'Publishing something else is its own decision — the registry, the credential, the ' +
          'support obligation and whether a per-package tag now anchors anything — so make it ' +
          'in a merge request that says so, and change this check in the same commit.',
      });
    }

    // 2b — fitness. What a published package owes a consumer, and what npm's
    // own provenance prerequisite needs. `license` is deliberately not judged:
    // the owner deferred the licence to the merge request that makes a package
    // public on **npmjs** (D-203, amended 2026-09-04), and licence
    // rights come from the contract rather than from the manifest.
    const missing: string[] = [];
    if (!member.repository) missing.push('`repository`');
    if (member.access === null) missing.push('`publishConfig.access`');
    if (missing.length > 0) {
      findings.push({
        kind: 'incomplete-public-package',
        subject: member.name,
        message:
          `(${member.dir}) is public and declares no ${missing.join(' and no ')}. ` +
          '`repository` is what gives a consumer a path from the package page back to the ' +
          'code, and npm makes provenance conditional on it; `publishConfig.access` is a ' +
          'property of the package rather than of where it happens to be published, and it ' +
          'is the value that decides whether a scoped package lands public or private.',
      });
    }

    // 2c — the access decision the rehearsal cannot exercise. GitLab ignores
    // `--access` and takes visibility from the project, so nothing about a
    // private-registry publish would reveal this before the first public one.
    const effectiveAccess = member.access ?? configAccess ?? 'restricted';
    if (effectiveAccess === 'restricted') {
      findings.push({
        kind: 'restricted-public-package',
        subject: member.name,
        message:
          `(${member.dir}) resolves \`access\` to \`restricted\` ` +
          `(${member.access !== null ? 'its own `publishConfig.access`' : configAccess !== null ? '`.changeset/config.json`' : "the changesets default, since neither the package nor `.changeset/config.json` states one"}). ` +
          'On npmjs a scoped package is private by default and a private package requires a ' +
          'paid account, so this publishes to nobody or fails outright. GitLab ignores ' +
          '`--access` entirely, which is why the rehearsal cannot discover it and this check ' +
          'has to (feature 104, FR-012).',
      });
    }

    // 2d — a scope the registry cannot serve. Silent, by R2.1: the request is
    // forwarded to npmjs and the client is told the package does not exist.
    const problem = unservableScope(member.name);
    if (problem !== null) {
      findings.push({
        kind: 'unresolvable-scope',
        subject: member.name,
        message:
          `(${member.dir}) ${problem} GitLab's instance-level npm endpoint resolves a package ` +
          'by turning its scope into a top-level namespace path, and a scope that resolves to ' +
          'none is **not** an error: the request is forwarded to `registry.npmjs.org` and the ' +
          'client is told the package is not in the npm registry ' +
          '(`contracts/registry-and-scope.md` R2/R2.1, measured).',
      });
    }
  }

  // 2e — one client `.npmrc`, one scope (R3). A second scope resolves through
  // whatever the client's default registry is, which is the same silence.
  const scopes = [...new Set(publicVersionable.map((member) => scopeOf(member.name)))].sort();
  if (scopes.length > 1) {
    findings.push({
      kind: 'unresolvable-scope',
      subject: scopes.map((scope) => scope ?? '(unscoped)').join(', '),
      message:
        'are the scopes the public packages are published under. A consumer holds one `.npmrc` ' +
        'line per scope (`contracts/registry-and-scope.md` R3) and the scaffolded storefront ' +
        'writes one, so every scope after the first resolves through the client\'s default ' +
        'registry instead — which serves none of them and says so as "not in the npm registry".',
    });
  }

  // 3 — the tag policy, total in both states. The old rule asked only while
  // *every* versionable package was private, so the first public one made it
  // stop firing in either direction and nothing then held the field at all.
  if (privateVersionable.length > 0 && settings['tag'] !== false) {
    findings.push({
      kind: 'tag-policy-unstated',
      subject: 'privatePackages.tag',
      message:
        `is ${JSON.stringify(settings['tag'] ?? null)} while ${privateVersionable.length} ` +
        'versionable package(s) are private. `changeset tag` would then write one ref per ' +
        'private package per release, naming a version no registry serves — a fact derived ' +
        'from the commit that wrote it (D-100), written into a ref every clone fetches. Set ' +
        'it to `false`; a public package is git-tagged regardless of this field.',
    });
  }
  if (privateVersionable.length === 0 && typeof settings['tag'] !== 'boolean') {
    findings.push({
      kind: 'tag-policy-unstated',
      subject: 'privatePackages.tag',
      message:
        'is not stated, and no versionable package is private any more. The field then governs ' +
        'nothing — `changeset publish` tags a public package whatever it says — so its absence ' +
        'is the `@changesets/config@4` default rather than a decision, and a reader cannot ' +
        'tell the policy from the silence. Write it, `true` or `false`, in the merge request ' +
        'that made the last package public.',
    });
  }

  // 4/5 — the ignore list, both directions.
  for (const member of inputs.members) {
    if (member.family && isIgnored(member.name)) {
      findings.push({
        kind: 'ignored-family-member',
        subject: member.name,
        message:
          `(${member.dir}) is produced by the workspace entr${member.globs.length === 1 ? 'y' : 'ies'} ` +
          `${member.globs.map((glob) => `\`${glob}\``).join(', ')} — a library family — and an ` +
          '`ignore` pattern matches its name, so a merge request may change it without saying ' +
          'what that means for anyone consuming it. `ignore` is for applications nobody ' +
          'resolves by version.',
      });
    }
    if (!member.family && !isIgnored(member.name)) {
      findings.push({
        kind: 'unignored-application',
        subject: member.name,
        message:
          `(${member.dir}) comes from the literal workspace entr${member.globs.length === 1 ? 'y' : 'ies'} ` +
          `${member.globs.map((glob) => `\`${glob}\``).join(', ')} — one deployable, not a ` +
          'library — and no `ignore` pattern matches it, so every merge request touching it ' +
          'will demand a changeset for something nobody installs by version. Add its **name** ' +
          'to `ignore` (the list is glob-matched against names, never paths).',
      });
    }
  }

  // 6 — a claim about this repository that this repository no longer holds.
  for (const pattern of ignorePatterns) {
    if (inputs.members.some((member) => matchesPattern(pattern, member.name))) continue;
    findings.push({
      kind: 'stale-ignore-entry',
      subject: pattern,
      message:
        'matches no workspace package. `ignore` is glob-matched against package **names**, ' +
        'so a path written there (`packages/*`) matches nothing at all and the entry it was ' +
        'meant to replace stops being ignored.',
    });
  }

  // 7 — a group that has quietly stopped covering one of its members.
  for (const name of groupMembers(inputs.config)) {
    if (inputs.members.some((member) => member.name === name)) continue;
    findings.push({
      kind: 'stale-group-member',
      subject: name,
      message:
        'is named by a `linked` or `fixed` group and is not a workspace package. The group ' +
        'goes on applying to the others and nothing reports that it stopped applying to this ' +
        'one — which for a `linked` group means the version agreement it exists to enforce is ' +
        'quietly one package short.',
    });
  }

  // 8 — the reconciliation: written intent against derived classification.
  for (const release of inputs.changesets) {
    const member = inputs.members.find((candidate) => candidate.name === release.packageName);
    if (member === undefined) {
      findings.push({
        kind: 'unversionable-changeset',
        subject: `${release.file}:${release.packageName}`,
        message:
          'names a package that is not a workspace member. `changeset version` will refuse ' +
          'the run, or drop the intent, depending on how the name got there.',
      });
      continue;
    }
    if (isIgnored(member.name)) {
      findings.push({
        kind: 'unversionable-changeset',
        subject: `${release.file}:${release.packageName}`,
        message:
          'names a package that `ignore` matches, so the bump written here will never be ' +
          'applied. Either the package belongs in the release, or the changeset does not.',
      });
    }
  }

  return findings;
}

/** The whole check over a checkout: read, refuse, or analyse. */
export function checkReleaseIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
): ReleaseIntentResult | ReleaseIntentRefusal {
  const inputs = readReleaseIntent(repoRoot, fs, listChangesets);
  if ('reason' in inputs) return inputs;

  const unreadable = unreadablePattern(stringList(inputs.config['ignore']));
  if (unreadable !== null) {
    return {
      reason:
        `the \`ignore\` pattern \`${unreadable}\` uses a glob grammar this check does not ` +
        'implement (micromatch has extglobs, braces and negation; this file has `*` and `?`). ' +
        'Reporting it as matching nothing would be a claim this run never made.',
    };
  }

  // Feature 104's two refusals, and both are conditional: which packages *may*
  // be public is a question an all-private checkout never asks, so a repository
  // with no reference storefront is refused only once one is. Answered before
  // the findings, because reporting a public package as expected — or as
  // unexpected — off an undecidable population is the verdict issue #113 is
  // about.
  const publicVersionable = inputs.members.filter((member) => member.family && !member.isPrivate);
  if (publicVersionable.length > 0 && inputs.publication.members === null) {
    return {
      reason:
        `${String(publicVersionable.length)} versionable package(s) are public and ` +
        `${inputs.publication.unresolved}`,
    };
  }

  const ignorePatterns = stringList(inputs.config['ignore']);
  // One per decision taken inside the files read: each member classified, each
  // ignore pattern resolved, each group member looked up, plus the two
  // `privatePackages` settings. Feature 104 adds four per public versionable
  // member — may it be public, is it complete, what does its access resolve to,
  // can the registry serve its scope — and one for the scope agreement across
  // the set, which is a decision about the set rather than about a member.
  //
  // **The changeset reconciliations are decisions and are deliberately not
  // counted here**, for the reason given at `files` above: their number follows
  // the release cycle rather than the tree, and a band over an oscillating
  // quantity jams in both directions. They are printed beside this as
  // `changesets=`, which is where a reader should look for how many there were.
  const sites =
    inputs.members.length +
    ignorePatterns.length +
    groupMembers(inputs.config).length +
    2 +
    publicVersionable.length * 4 +
    (publicVersionable.length > 0 ? 1 : 0);
  const globs = [...inputs.globCoverage.keys()];
  // The independent derivation: `pnpm-workspace.yaml` says how many entries
  // should produce a member, and the manifests on disk say how many did. Move
  // `packages/` and the four application entries still answer every question
  // above — which is issue #215's short walk over exactly this population.
  const coverage: readonly ReadCoverage[] = [
    {
      source: 'workspace-globs',
      expected: globs.length,
      covered: globs.filter((glob) => (inputs.globCoverage.get(glob) ?? 0) > 0).length,
    },
  ];

  // The read-size floor is part of the analysis and not of the printing. It sat
  // in the CLI's `reportReadSize` first, which meant a red proof entering where
  // a real run enters could not reach it — the exact shape issue #130 is about,
  // one layer down from the checks it was found in.
  const short = readSizeRefusal({ prefix: PREFIX, files: inputs.files, sites, coverage });
  if (short !== null) return { reason: short.message };

  return { findings: analyzeReleaseIntent(inputs), inputs, sites, coverage };
}

// --- the published surface, and the diff that reaches it -------------------

/** What one versionable package compiles into its published `dist`. */
export interface PublishedSurface {
  readonly name: string;
  /** Repository-relative package directory — what `changeset status` watches. */
  readonly dir: string;
  /** Repository-relative `include` patterns, resolved from the build config. */
  readonly include: readonly string[];
  /** Repository-relative `exclude` patterns, same resolution. */
  readonly exclude: readonly string[];
  /** How many tsconfigs the `extends` chain opened to answer. */
  readonly filesRead: number;
}

/** The branch, as two lists of repository-relative paths, against a named baseline. */
export interface BranchDiff {
  /** The ref the branch was measured against, as it was given on the command line. */
  readonly baseline: string;
  /**
   * Whether every commit of `HEAD` is already reachable from the baseline —
   * `git merge-base --is-ancestor HEAD <baseline>`.
   *
   * This is a **different fact** from an empty {@link changedPaths}, and telling
   * the two apart is the whole reason it is carried: see
   * {@link ReleaseIntentContainment}.
   */
  readonly containedInBaseline: boolean;
  /** Every file the branch changes, relative to the repository root. */
  readonly changedPaths: readonly string[];
  /** The `.changeset/*.md` files the branch **adds** (README excluded). */
  readonly addedChangesets: readonly string[];
}

/**
 * The baseline already contains the branch, so there is no delta to judge.
 *
 * **This is a verdict, not a refusal, and the distinction is the repair of
 * pipeline 11491.** A merge request that changed six files exited 2 on *"the
 * branch changes no file at all"* because it had already been merged when the
 * job fetched its baseline: `HEAD` was an ancestor of `origin/master`, so
 * `merge-base(origin/master, HEAD)` **was** `HEAD` and the three-dot diff
 * compared the branch with itself. At this project's merge cadence that fires
 * regularly, and a gate that is red for a reason no author can act on is a gate
 * people learn to scroll past — which is the same silence issue #113 refuses,
 * wearing the other costume.
 *
 * So the empty diff splits in two, and only one half is a refusal:
 *
 *   * **Not contained, and the diff is empty** — a branch with a real fork point
 *     whose commits change no file. The measurement came back empty; it was not
 *     empty by construction. That stays exit 2, verbatim.
 *   * **Contained** — every question this mode asks is of the form *"does this
 *     branch add X to the baseline without a changeset?"*, and the set of files
 *     it adds is empty **because the baseline holds them all already**. That is
 *     a measured answer, established by one git command that returns a definite
 *     yes, and it is reported as such.
 *
 * Containment cannot be manufactured to slip past the gate, which is what makes
 * the pass safe: to be an ancestor of the target, every commit must already be
 * in the target — and getting them there needed a merge, whose own pipeline ran
 * this gate against a baseline that did not yet contain them. A **squash** merge
 * copies the content and leaves the commit outside that history, so such a
 * branch is *not* contained and is judged normally.
 *
 * The configuration half of this check is unaffected: it runs in `quality`, on
 * every merge request, with no diff and no baseline.
 */
export interface ReleaseIntentContainment {
  /** Why there is no delta to judge, in full. */
  readonly contained: string;
}

export interface PublishedSurfaceResult {
  readonly findings: readonly ReleaseIntentFinding[];
  readonly surfaces: readonly PublishedSurface[];
  readonly files: number;
  readonly sites: number;
  readonly coverage: readonly ReadCoverage[];
}

/**
 * Strip `//` line comments — the tsconfigs in this repository carry them, and
 * `packages/platform/tsconfig.json` carries more comment than configuration.
 * Line comments only: no block comment is written in one here.
 */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

/**
 * Collapse `.` and `..` in a POSIX path. Deliberately string-only: the patterns
 * being resolved are `include` entries relative to a tsconfig, and turning them
 * into absolute filesystem paths would make the analysis depend on where the
 * checkout is rather than on what it declares.
 */
export function normalizeRelative(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/**
 * Whether `path` matches a tsconfig `include`/`exclude` pattern.
 *
 * The three constructs tsconfig defines: `**` spans any number of segments
 * including none, `*` any run inside one segment, `?` one character inside one.
 * A pattern with no glob character at all names a directory, which tsconfig
 * reads as everything under it — the shape `"include": ["src"]` takes.
 */
export function matchesTsGlob(pattern: string, path: string): boolean {
  const effective = /[*?]/.test(pattern) ? pattern : `${pattern}/**/*`;
  const patternSegments = effective.split('/');
  const pathSegments = path.split('/');

  const walk = (p: number, s: number): boolean => {
    if (p === patternSegments.length) return s === pathSegments.length;
    const head = patternSegments[p]!;
    if (head === '**') {
      for (let skip = s; skip <= pathSegments.length; skip += 1) {
        if (walk(p + 1, skip)) return true;
      }
      return false;
    }
    if (s === pathSegments.length) return false;
    const source = head
      .split(/([*?])/)
      .map((part) => (part === '*' ? '[^/]*' : part === '?' ? '[^/]' : escapeRegExp(part)))
      .join('');
    if (!new RegExp(`^${source}$`).test(pathSegments[s]!)) return false;
    return walk(p + 1, s + 1);
  };

  return walk(0, 0);
}

/**
 * The `include`/`exclude` of one package's emit configuration, resolved to
 * repository-relative patterns.
 *
 * Follows `extends` because that is where the answer actually lives: !891 puts
 * `include` in `tsconfig.json` and `rootDir` in the `tsconfig.build.json` that
 * extends it, so a reader of the build file alone would find no `include` and
 * conclude the package publishes nothing outside itself — the exact silence
 * this mode exists to remove. Only relative `extends` is followed; a package
 * reference (`extends: "@scope/tsconfig/base"`) is reported as unreadable
 * rather than treated as absent.
 */
export function readPublishedSurface(
  repoRoot: string,
  packageDir: string,
  packageName: string,
  fs: WorkspaceFs,
): PublishedSurface | ReleaseIntentRefusal {
  const seen = new Set<string>();
  let current = `${packageDir}/tsconfig.build.json`;
  let include: readonly string[] | null = null;
  let exclude: readonly string[] = [];
  let excludeFrom = '';

  while (current !== '') {
    if (seen.has(current)) {
      return { reason: `\`${current}\` is part of an \`extends\` cycle` };
    }
    seen.add(current);
    const text = fs.readText(join(repoRoot, current));
    if (text === null) {
      return { reason: `\`${current}\` could not be read, so what \`${packageName}\` publishes is unknown` };
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(stripLineComments(text)) as Record<string, unknown>;
    } catch (error) {
      return { reason: `\`${current}\` does not parse: ${String(error)}` };
    }

    const dir = current.slice(0, current.lastIndexOf('/'));
    const resolve = (pattern: string): string => normalizeRelative(`${dir}/${pattern}`);
    if (include === null && Array.isArray(config['include'])) {
      include = stringList(config['include']).map(resolve);
    }
    if (excludeFrom === '' && Array.isArray(config['exclude'])) {
      exclude = stringList(config['exclude']).map(resolve);
      excludeFrom = current;
    }
    // The nearest `include` wins and there is nothing further to learn: a base
    // config above it describes a different compilation. Stopping here is also
    // what keeps the chain short — `tsconfig.base.json` declares no `include`
    // and is not this package's statement about what it publishes.
    if (include !== null) break;

    const parent = config['extends'];
    if (parent === undefined) break;
    if (typeof parent !== 'string' || !parent.startsWith('.')) {
      return {
        reason:
          `\`${current}\` extends \`${String(parent)}\`, which is not a relative path — this ` +
          `check cannot follow it, and treating it as absent would report \`${packageName}\` ` +
          'as publishing nothing outside its own directory',
      };
    }
    current = normalizeRelative(`${dir}/${parent}`);
  }

  if (include === null) {
    return {
      reason:
        `\`${packageDir}/tsconfig.build.json\` and its \`extends\` chain declare no \`include\`, ` +
        `so every file in the checkout is a candidate source of \`${packageName}\` and none of ` +
        'them can be attributed',
    };
  }

  // `dist` is never a source. Without this a rebuilt artefact under a package
  // whose `include` is written broadly reads as a published-source change.
  return {
    name: packageName,
    dir: packageDir,
    include,
    exclude: [...exclude, `${packageDir}/dist`],
    filesRead: seen.size,
  };
}

/** Whether the package's build configuration compiles `path`. */
export function compilesPath(surface: PublishedSurface, path: string): boolean {
  if (!surface.include.some((pattern) => matchesTsGlob(pattern, path))) return false;
  return !surface.exclude.some((pattern) => matchesTsGlob(pattern, path));
}

/**
 * The findings `changeset status` structurally cannot produce.
 *
 * Pure over the resolved surfaces and the diff, so a red proof drives it with a
 * synthetic repository rather than with a pre-computed verdict.
 */
export function analyzePublishedSurfaceIntent(
  surfaces: readonly PublishedSurface[],
  diff: BranchDiff,
): readonly ReleaseIntentFinding[] {
  if (diff.addedChangesets.length > 0) return [];

  const findings: ReleaseIntentFinding[] = [];
  for (const surface of surfaces) {
    const unseen = diff.changedPaths.filter(
      (path) => !path.startsWith(`${surface.dir}/`) && compilesPath(surface, path),
    );
    if (unseen.length === 0) continue;
    findings.push({
      kind: 'unattributed-published-change',
      subject: surface.name,
      message:
        `compiles ${unseen.length} changed file(s) into its published \`dist\` from outside ` +
        `\`${surface.dir}/\`, and this branch adds no changeset: ` +
        `${unseen.slice(0, 5).join(', ')}${unseen.length > 5 ? ', …' : ''}. ` +
        '`changeset status` attributes a change to a package by the package\'s own directory, ' +
        'so it reports nothing for these — the gate waives a changeset for the files that ' +
        'reach a consumer while demanding one for the files that do not. Write the changeset, ' +
        'or an empty one if the change carries no release meaning.',
    });
  }
  return findings;
}

/** The `--since` mode over a checkout: resolve every published surface, then analyse. */
export function checkPublishedSurfaceIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
  diff: BranchDiff,
): PublishedSurfaceResult | ReleaseIntentContainment | ReleaseIntentRefusal {
  // First, and before anything is read: containment is a property of the commit
  // graph, so nothing below it has an input. Answering it here rather than in
  // the CLI is what lets a red proof drive it where a real run enters, and what
  // keeps it ahead of the empty-diff refusal it has to be told apart from.
  if (diff.containedInBaseline) {
    return {
      contained:
        `every commit of HEAD is already reachable from \`${diff.baseline}\`, so the branch is ` +
        `already contained in \`${diff.baseline}\` and adds no file to it. That is what a merge ` +
        'request looks like once it has been merged while its own pipeline was still running: ' +
        'the merge base is HEAD itself, so the diff is the branch against itself. Nothing is ' +
        'left to attribute to a package and nothing is left to demand a changeset for — this is ' +
        'an answer, not an empty measurement. The configuration half of this check ran in ' +
        '`quality` and is unaffected.',
    };
  }

  const inputs = readReleaseIntent(repoRoot, fs, listChangesets);
  if ('reason' in inputs) return inputs;

  const ignorePatterns = stringList(inputs.config['ignore']);
  const versionable = inputs.members.filter(
    (member) => member.family && !ignorePatterns.some((p) => matchesPattern(p, member.name)),
  );
  if (versionable.length === 0) {
    return { reason: 'no versionable package — there is no published surface to attribute a diff to' };
  }

  const surfaces: PublishedSurface[] = [];
  for (const member of versionable) {
    const surface = readPublishedSurface(repoRoot, member.dir, member.name, fs);
    if ('reason' in surface) return surface;
    surfaces.push(surface);
  }

  if (diff.changedPaths.length === 0) {
    return {
      reason:
        'the branch changes no file at all — every question below would be vacuously true, ' +
        'and a merge request with an empty diff is not the input this mode was asked about. ' +
        `It is **not already contained in \`${diff.baseline}\`** either (that answer has its ` +
        'own line and exits 0), so this is a branch with a real fork point whose commits change ' +
        'nothing: the measurement came back empty rather than being empty by construction',
    };
  }

  const coverage: readonly ReadCoverage[] = [
    { source: 'versionable-packages', expected: versionable.length, covered: surfaces.length },
  ];
  // Every tsconfig each `extends` chain actually opened, on top of what the
  // default mode opened. Files, not chains: `files` is what the walk opened.
  const files = inputs.files + surfaces.reduce((total, surface) => total + surface.filesRead, 0);
  // One decision per (surface, changed path) pair: does this package compile it,
  // and can the CLI see that it does.
  const sites = surfaces.length * diff.changedPaths.length;

  const short = readSizeRefusal({ prefix: PREFIX, files, sites, coverage });
  if (short !== null) return { reason: short.message };

  return { findings: analyzePublishedSurfaceIntent(surfaces, diff), surfaces, files, sites, coverage };
}

// --- CLI -------------------------------------------------------------------

function listDirectoryFiles(dir: string): readonly string[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
}

/**
 * The branch, read with git. A failure here is exit 2 rather than an empty
 * diff: "nothing changed" and "git could not answer" are the same silence the
 * whole file exists to refuse.
 */
function readBranchDiff(repoRoot: string, since: string): BranchDiff | ReleaseIntentRefusal {
  const run = (args: readonly string[]): string[] | null => {
    try {
      return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    } catch {
      return null;
    }
  };

  if (run(['rev-parse', '--verify', '--quiet', `${since}^{commit}`]) === null) {
    return { reason: `\`${since}\` does not resolve to a commit` };
  }
  if (run(['merge-base', since, 'HEAD']) === null) {
    return { reason: `there is no merge base between HEAD and \`${since}\`` };
  }

  // `--is-ancestor` answers with an exit code, and 1 is an *answer* rather than
  // a failure, so this one cannot go through `run` — which reads every non-zero
  // status as "git could not answer". Anything other than 0 or 1 still is.
  const containment = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', since], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (containment.status !== 0 && containment.status !== 1) {
    return { reason: `\`git merge-base --is-ancestor HEAD ${since}\` failed` };
  }
  const containedInBaseline = containment.status === 0;

  // The diff stays three-dot, which is `merge-base(since, HEAD)..HEAD` — a merge
  // request's own diff, and already the right baseline. It is stated here
  // because "compare against the merge base" is the first repair anyone reaches
  // for on seeing pipeline 11491, and it is a no-op: on a merged branch the
  // merge base *is* HEAD, so the merge base is exactly what produces the empty
  // diff. The fact above is what tells that case from a branch that changes
  // nothing; re-baselining cannot.
  const changedPaths = run(['diff', '--no-renames', '--name-only', `${since}...HEAD`]);
  if (changedPaths === null) return { reason: `\`git diff ${since}...HEAD\` failed` };
  const added = run([
    'diff',
    '--no-renames',
    '--diff-filter=A',
    '--name-only',
    `${since}...HEAD`,
    '--',
    '.changeset',
  ]);
  if (added === null) return { reason: `\`git diff --diff-filter=A ${since}...HEAD\` failed` };

  return {
    baseline: since,
    containedInBaseline,
    changedPaths,
    addedChangesets: added.filter(
      (path) => path.endsWith('.md') && !path.toLowerCase().endsWith('readme.md'),
    ),
  };
}

/** The `--since` half of the CLI. Returns the process exit code. */
function reportPublishedSurface(repoRoot: string, since: string): number {
  const diff = readBranchDiff(repoRoot, since);
  if ('reason' in diff) {
    console.error(`${PREFIX} ${diff.reason}; refusing to report a verdict it did not measure.`);
    return 2;
  }

  const result = checkPublishedSurfaceIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles, diff);
  if ('contained' in result) {
    // Loud on stdout rather than a bare exit 0: the verdict is a pass, and a
    // pass nobody can tell from an ordinary one is how "measured nothing" would
    // creep back in through the door this branch opened.
    console.log(`${PREFIX} --since=${since} contained=yes changed=0 violations=0`);
    console.log(`${PREFIX} ${result.contained}`);
    return 0;
  }
  if ('reason' in result) {
    console.error(`${PREFIX} ${result.reason}; refusing to report a verdict it did not measure.`);
    return 2;
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.files,
    sites: result.sites,
    coverage: result.coverage,
  });
  console.log(
    `${PREFIX} --since=${since} surfaces=${result.surfaces.length} ` +
      `changed=${diff.changedPaths.length} changesets-added=${diff.addedChangesets.length} ` +
      `violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nThis branch changes a published surface that `changeset status` cannot attribute to ' +
        'its package, so the gate exits 0 over a change a consumer will receive:',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.subject} ${finding.message}`);
    }
  }

  return result.findings.length === 0 ? 0 : 1;
}

function main(): void {
  const rootFlag = process.argv.indexOf('--root');
  const repoRoot =
    rootFlag >= 0 && process.argv[rootFlag + 1] !== undefined
      ? process.argv[rootFlag + 1]!
      : fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

  const sinceFlag = process.argv.indexOf('--since');
  if (sinceFlag >= 0) {
    const since = process.argv[sinceFlag + 1];
    if (since === undefined || since.startsWith('--')) {
      console.error(`${PREFIX} \`--since\` needs a ref; refusing to report a verdict it did not measure.`);
      process.exit(2);
    }
    process.exit(reportPublishedSurface(repoRoot, since));
  }

  const result = checkReleaseIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles);
  if ('reason' in result) {
    console.error(`${PREFIX} ${result.reason}; refusing to report a verdict it did not measure.`);
    process.exit(2);
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.inputs.files,
    sites: result.sites,
    coverage: result.coverage,
  });
  const versionable = result.inputs.members.filter((member) => member.family).length;
  console.log(
    `${PREFIX} versionable=${versionable} ignored=${result.inputs.members.length - versionable} ` +
      `changesets=${result.inputs.changesets.length} violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nThe release-intent gate would stop asking. Every finding below produces `exit 0` ' +
        'from `changeset status`, which is byte-identical to a clean branch:',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.subject} ${finding.message}`);
    }
  }

  process.exit(result.findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module from a test must not scan and exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
