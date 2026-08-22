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
 *   * `publishable-package` — a versionable member that is not `"private": true`
 *     (D-160.5: everything stays private through Wave 4). Publication is its own
 *     merge request, and this is what makes the tag question land in it: see
 *     *Tags* below.
 *   * `tag-without-publication` — `privatePackages.tag` is not `false` while
 *     every versionable member is private. A per-package tag that nothing
 *     resolves is a derived fact written into a ref.
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
 * ## Tags
 *
 * There are none, and the two findings above are the enforcement of that answer
 * rather than a restatement of it. While every package is private, a git tag
 * naming a package version anchors nothing a reader cannot re-derive from the
 * commit that wrote the `version` field — D-100's shape, written into a ref that
 * every clone then fetches. What would make a tag *anchor* something is
 * publication: a tag is how you assert that this exact tree is what a registry
 * serves under that version, which git history alone cannot say about a
 * registry. So `privatePackages.tag` stays `false` and flips in the same merge
 * request that flips `private` — and `publishable-package` is what makes those
 * two edits arrive together instead of a year apart.
 *
 * ## Exit 2 — six ways it refuses to report on what it did not read
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
 * `--since` adds four of its own, for the same reason: a versionable package
 * with no readable `tsconfig.build.json`, a build configuration with no
 * `include` at all, an `extends` chain this file cannot follow, and a git
 * invocation that failed. Each of them would otherwise mean "this package
 * publishes nothing outside its own directory", which is the answer that lets
 * the gate stay quiet.
 *
 * Usage: `tsx scripts/check-release-intent.ts [--root <dir>] [--since <ref>]`
 * Exit 0 = the flow can still go red; 1 = a finding; 2 = it did not read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSizeRefusal, reportReadSize, type ReadCoverage } from './lib/read-size.js';
import {
  expandWorkspaceGlob,
  nodeWorkspaceFs,
  workspaceGlobs,
  workspaceMembers,
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
  /** Files opened, for the read line. */
  readonly files: number;
}

export type ReleaseIntentFindingKind =
  | 'version-disabled'
  | 'publishable-package'
  | 'tag-without-publication'
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

  const members = workspaceMembers(repoRoot, fs);
  if (members.length === 0) {
    return { reason: 'the workspace globs matched no package at all' };
  }

  const globCoverage = new Map<string, number>();
  const matchedGlobs = new Map<string, string[]>();
  for (const glob of globs) {
    const dirs = new Set(expandWorkspaceGlob(repoRoot, glob, fs));
    let covered = 0;
    for (const member of members) {
      if (!dirs.has(member.dir)) continue;
      covered += 1;
      const list = matchedGlobs.get(member.dir) ?? [];
      list.push(glob);
      matchedGlobs.set(member.dir, list);
    }
    globCoverage.set(glob, covered);
  }

  const classified: ClassifiedMember[] = members.map((member) => {
    const own = matchedGlobs.get(member.dir) ?? [];
    return {
      name: member.name,
      dir: member.dir.startsWith(repoRoot) ? member.dir.slice(repoRoot.length + 1) : member.dir,
      isPrivate: member.manifest['private'] === true,
      family: own.some((glob) => glob.includes('*')),
      globs: own,
    };
  });

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
    // config.json + pnpm-workspace.yaml + one manifest per member + the
    // changesets themselves. What the walk *opened*, never what it found in.
    files: 2 + members.length + changesetFiles.length,
  };
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

  // 2 — D-160.5, and the merge request the tag decision belongs in.
  for (const member of versionable.filter((candidate) => !candidate.isPrivate)) {
    findings.push({
      kind: 'publishable-package',
      subject: member.name,
      message:
        `(${member.dir}) is not \`"private": true\`. D-160.5 keeps every package private ` +
        'through Wave 4; publication is its own merge request, and it is the one that has to ' +
        'decide the registry, the credential and whether a per-package tag now anchors ' +
        'something. Make that decision there, and change this check in the same commit.',
    });
  }

  // 3 — a tag nobody resolves.
  if (privateVersionable.length === versionable.length && settings['tag'] !== false) {
    findings.push({
      kind: 'tag-without-publication',
      subject: 'privatePackages.tag',
      message:
        `is ${JSON.stringify(settings['tag'] ?? null)} while every versionable package is ` +
        'private. `changeset tag` would then write one ref per package per release, naming a ' +
        'version no registry serves — a fact derived from the commit that wrote it (D-100), ' +
        'written into a ref every clone fetches. Set it to `false` until something publishes.',
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

  const ignorePatterns = stringList(inputs.config['ignore']);
  // One per decision taken inside the files read: each member classified, each
  // ignore pattern resolved, each group member looked up, each changeset
  // release reconciled, plus the two `privatePackages` settings.
  const sites =
    inputs.members.length +
    ignorePatterns.length +
    groupMembers(inputs.config).length +
    inputs.changesets.length +
    2;
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

/** The branch, as two lists of repository-relative paths. */
export interface BranchDiff {
  /** Every file the branch changes, relative to the repository root. */
  readonly changedPaths: readonly string[];
  /** The `.changeset/*.md` files the branch **adds** (README excluded). */
  readonly addedChangesets: readonly string[];
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
): PublishedSurfaceResult | ReleaseIntentRefusal {
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
        'and a merge request with an empty diff is not the input this mode was asked about',
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
