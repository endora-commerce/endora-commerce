/**
 * CI check — a test file belongs to the module it is about, and a module
 * package's tests are configured to run.
 *
 * Normative:
 * `specs/106-module-owned-tests/contracts/module-test-ownership.md` (§1 the
 * ownership table, §3 what a package's test may name, §4 the findings, §6 the
 * read line, §7 exit 2, §8 estate registration), extended by
 * `specs/109-backend-test-kit/contracts/test-kit-package.md` §5 and §7 —
 * see *Serving both features* below.
 *
 * ## What was unenforced
 *
 * Feature 106 merged on 2026-09-04 and moved 211 test files into 56 module
 * packages. Its instrument did not merge with it. Measured on `master`
 * `192c4d25f` before this file existed: **1428** test files remain under
 * `backend/test`, **185** of which are harness-free and name exactly one
 * module — files 106's own predicate places in that module's package — and
 * nothing reported one, nothing stopped the 186th being written, and the 56
 * packages that grew a `vitest.config.ts` were guarded by nothing at all. A
 * package whose configuration was deleted would have gone on shipping test
 * files that no job collects, which is the state that looks greenest.
 *
 * ## §1 — ownership, and the one thing it is *not* keyed on
 *
 * `owners(file)` is read out of the file's **import specifiers**, in both
 * spellings the mixed tree writes:
 *
 * ```
 * owners(file) = { <id> : a specifier resolving into "packages/modules/<id>" }
 *              ∪ { <id> : a bare specifier naming that module's package }
 * ```
 *
 * It is deliberately not the **directory the test sits in**. That predicate has
 * been tried in this repository and it is wrong in both directions at once:
 * `check:off-state-coverage`'s row records a population derived by hand three
 * times, giving three different answers, because nine files sitting in one
 * module's directory name a different module. `backend/test/unit/<id>/` is a
 * convention, and a convention is a fact about who typed the path.
 *
 * The bare half is read through the layout's `modulePackageNames` — the npm
 * name each package declares mapped to the `endora.id` it declares — so nothing
 * here spells `@endora-commerce/mod-` or `packages/modules` (D-100). A module
 * whose package is named differently is followed; a `mod-` prefix rule would
 * be a derived fact written down.
 *
 * ## The table, and the cell that moves
 *
 * | `|owners|` | composes a server | verdict |
 * | --- | --- | --- |
 * | 1 | no | **the module's** — it belongs in `packages/modules/<id>/src/**` |
 * | 1 | yes | the module's **iff that module can host a server-bound test**, else the repository's |
 * | 0 | any | the repository's — the platform's own test |
 * | ≥ 2 | any | the repository's — a file with two owners has none |
 *
 * ## Serving both features
 *
 * `specs/109-backend-test-kit/` (merge request !1401, unmerged) makes this
 * instrument its Phase 4 and changes exactly one cell of that table: with
 * `@endora-commerce/test-kit` in the tree, a single-owner file that composes a
 * server becomes the module's too (R5.1), **gated per module** on that module
 * being able to run one.
 *
 * So the capability is an **input** to the classification rather than a
 * constant folded into it — {@link TestOwnershipInput.serverBoundHosts}, the
 * module ids able to host a server-bound test. Today the repository host
 * computes it as the empty set, and that is a derivation rather than a
 * decision: the only server composer in this checkout is
 * `backend/test/helpers/test-server.ts`, §3 refuses a package naming
 * `backend/`, so no module can host one. {@link serverBoundHosts} is the one
 * function 109's Phase 4 changes, and the companion test already drives the
 * flipped cell — with a non-empty set the 196 files this run leaves with the
 * repository become `misplaced-test`, and `harness-bound-move` stops firing for
 * that module, because both sides of the boundary read the *same* predicate.
 * That is 109 R5.2's retirement, expressed as a derivation rather than as a
 * finding to delete.
 *
 * Three of 109's seven findings are **not** built here and their subjects are
 * why: `undeclared-test-dependency` needs §6's devDependency closure, which
 * `manifests:generate` renders and does not yet, `unowned-volatile-table` needs
 * the `./test-support` contribution shape, and `kit-names-a-module` needs the
 * kit. None of the three has a subject in this tree, and a finding over an
 * empty population is the vacuous pass this estate exists against.
 *
 * ## The five findings
 *
 *   * **`misplaced-test`** — a file under `backend/test/` the table places in a
 *     module. Ledgered, sharded per module, two-way, draining.
 *   * **`harness-bound-move`** — a file under a module package that composes a
 *     server the package may not name. No ledger: it is a scope boundary and an
 *     entry would be an exemption from the scope.
 *   * **`unconfigured-package-tests`** — a module package shipping a test file
 *     with no `test` script, or with no `vitest.config.ts` merging
 *     `vitest.config.base.ts` (which is where issue #255's foreign-workspace
 *     refusal lives, so a package that skips it can run another checkout's
 *     sources while reporting on this branch). No ledger: the remedy is two
 *     lines and always available.
 *   * **`outward-reach`** — §3's refusals: a test under a module package naming
 *     `backend/`, naming a sibling by relative path, or naming any `dist`.
 *   * **`unclassifiable-test`** — a file the analysis could not read.
 *     A **finding and never a skip** (issue #113): the repository is where an
 *     unmoved file already is, so reading an unreadable file as the
 *     repository's agrees with the defect.
 *
 * ## The ledger, and why it arrives holding 185
 *
 * The choice is between a check that lands red — 185 findings on day one, which
 * gets reverted rather than read — and a ledger that starts full, which is one
 * nobody drains. It arrives full, and the second horn is answered by making the
 * two kinds of entry **different values** rather than one sentence doing both
 * jobs:
 *
 *   * a **scheduled** entry, `{ scheduled: true, reason, retiredBy }`, is a file
 *     that has not moved yet. Its `retiredBy` names the batch, and it is
 *     counted and printed separately as `scheduled=` so the drain is a number
 *     on every run rather than a diff nobody sums.
 *   * a **plain string** entry is a file the repository has decided keeps living
 *     under `backend/test`. §4's rule — *"an entry's reason must say why the
 *     file is right to stay"* — is that kind's rule, and it is enforceable
 *     because it is no longer competing with 185 entries for which the honest
 *     answer is "not moved yet".
 *
 * §4 states both sentences and they cannot both hold of one entry kind; this is
 * that contradiction resolved in the mechanism rather than by writing 185
 * fictions. It is `check:module-boundary`'s `permanent: true` split with the
 * default inverted, for the reason the populations differ: there, an edge
 * standing is the ordinary case and permanence the exception; here, a file
 * waiting for its batch is the ordinary case and a file that stays is the
 * exception. There are **zero** of the second kind today.
 *
 * The key is the file path and never a line — a line-keyed entry reds on any
 * insertion above the site. Seven of `check:module-boundary`'s eight shard
 * failure modes apply and are enforced; the eighth, a recorded `sites` count
 * disagreeing with the walk, has **no subject here** and is deliberately not
 * implemented: the key *is* the finest unit, since a file gets exactly one
 * verdict, so a count field could never disagree with anything and would be a
 * field an author gets wrong for free.
 *
 * ## What it cannot see
 *
 * Stated here rather than discovered later. It reads specifiers, so a module a
 * test reaches through a **helper** in another file is invisible — the helper's
 * owners are the helper's. It reads {@link HOST_COMPOSERS} as call nodes, and
 * that list is not widened to "imports anything from `backend/test/helpers/`":
 * a helper that is not a host composer is a different question and reporting
 * them together would let each go blind behind the other's red. And it says
 * nothing about whether a test is good, current or complete.
 *
 * Usage: `tsx scripts/check-test-ownership.ts [--list]`
 * `--list` prints the misplaced count per module. (`--list <module-id>`, the
 * per-file query the paid-module extraction script's W2 gate asked instead of
 * carrying a predicate of its own, D-262 clause 1, retired with that script —
 * `specs/136-open-source-publication/` W3.3.)
 * Exit 0 = every test file is where the table puts it; exit 1 = at least one is
 * not, or a shard is stale; exit 2 = the run could not see the population it
 * judges — see {@link vacuousTestOwnership}.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { namedSpecifiers } from './lib/specifiers.js';
import { reportReadSize } from './lib/read-size.js';

export const PREFIX = '[test-ownership]';

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * A file the repository has decided keeps living under `backend/test`.
 *
 * Its reason says why the file is **right** to stay — §4's rule, which is
 * enforceable here precisely because {@link ScheduledLedgerEntry} carries the
 * other population.
 */
export type RetainedLedgerEntry = string;

/**
 * A file the table places in a module package and that has not moved yet.
 *
 * `retiredBy` names the batch, and it is not decorative: it is what makes
 * `scheduled=` a drain rather than a heap. "The cut merge request" is an
 * acceptable answer here and is not one for `check:module-boundary`'s permanent
 * entries, because the two flags mean opposite things — this one says *this
 * will go*, that one says *this stays*.
 */
export interface ScheduledLedgerEntry {
  readonly scheduled: true;
  /** Why the file is still under `backend/test`. */
  readonly reason: string;
  /** The batch or phase that moves it. */
  readonly retiredBy: string;
}

export type TestOwnershipLedgerEntry = RetainedLedgerEntry | ScheduledLedgerEntry;

/** The one entry type a shard may declare (issue #217). */
export const CANONICAL_SHARD_ENTRY_TYPE = 'Readonly<Record<string, TestOwnershipLedgerEntry>>';

/** `export const entries: <type> =`, with the type as the only capture. */
const ENTRY_DECLARATION = /export\s+const\s+entries\s*:([^=]+)=/;

/** The entry type a shard's source declares, or `null` when it declares none. */
export function declaredEntryType(source: string): string | null {
  const declared = ENTRY_DECLARATION.exec(source)?.[1];
  if (declared === undefined) return null;
  const normalised = declared.replace(/\s+/g, ' ').trim();
  return normalised === '' ? null : normalised;
}

export interface TestOwnershipLedgerShard {
  /** The module the shard is named for — the filename's stem. */
  readonly moduleId: string;
  readonly entries: Readonly<Record<string, TestOwnershipLedgerEntry>>;
  /**
   * The shard file's source text, so the analysis can read the entry type the
   * file **declares**. `undefined` means "built in memory", which is what the
   * fixtures hand in; the loader always sets it.
   */
  readonly source?: string;
}

/** Whether a shard value is the scheduled form. Structural, not nominal. */
export function isScheduled(entry: TestOwnershipLedgerEntry): entry is ScheduledLedgerEntry {
  return typeof entry !== 'string' && entry.scheduled === true;
}

/** The reason text an entry carries, whichever form it takes. */
export function reasonOf(entry: TestOwnershipLedgerEntry): string {
  return typeof entry === 'string' ? entry : entry.reason;
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export type TestOwnershipFindingKind =
  | 'misplaced-test'
  | 'harness-bound-move'
  | 'unconfigured-package-tests'
  | 'outward-reach'
  | 'unclassifiable-test';

export interface TestOwnershipFinding {
  readonly kind: TestOwnershipFindingKind;
  /** The module the finding is about, or `null` where none is attributable. */
  readonly moduleId: string | null;
  /** Repo-relative, forward slashes — the ledger key for `misplaced-test`. */
  readonly file: string;
  readonly detail: string;
}

/** Which root a test file was walked from. */
export type TestFileRoot = 'application' | 'module-package';

export interface TestFileUnderCheck {
  /** Repo-relative, forward slashes. */
  readonly key: string;
  readonly text: string;
  readonly root: TestFileRoot;
  /**
   * For a `module-package` file, the module whose package holds it. `null` for
   * an application file — its owners are derived from what it names.
   */
  readonly moduleId: string | null;
}

export interface PackageUnderCheck {
  readonly moduleId: string;
  /** Repo-relative directory, for the message. */
  readonly key: string;
  /** How many test files the walk found in it. */
  readonly testFiles: number;
  /** The `test` script the package declares, or `null`. */
  readonly testScript: string | null;
  /** `vitest.config.ts`'s source text, or `null` when there is none. */
  readonly vitestConfig: string | null;
}

export interface TestOwnershipInput {
  readonly files: readonly TestFileUnderCheck[];
  readonly packages: readonly PackageUnderCheck[];
  /** npm package name → module id, the layout's answer. */
  readonly modulePackageNames: ReadonlyMap<string, string>;
  /**
   * Modules able to host a server-bound test (109 R5.1). Empty in this
   * checkout — see the header's *Serving both features*.
   */
  readonly serverBoundHosts: ReadonlySet<string>;
  readonly ledger: readonly TestOwnershipLedgerShard[];
}

export type OwnershipVerdict = 'the-module' | 'the-repository';

export interface OwnershipInput {
  readonly owners: readonly string[];
  readonly composesServer: boolean;
  readonly serverBoundHosts: ReadonlySet<string>;
}

/**
 * §1's table, as a function — the whole of the ownership rule and the only
 * place either feature's version of it is written.
 *
 * A file with two owners has none: it is testing an interaction, and putting it
 * in either package would make that package's test suite depend on the other.
 */
export function ownershipOf(input: OwnershipInput): {
  readonly verdict: OwnershipVerdict;
  readonly moduleId: string | null;
} {
  if (input.owners.length !== 1) return { verdict: 'the-repository', moduleId: null };
  const moduleId = input.owners[0]!;
  if (!input.composesServer) return { verdict: 'the-module', moduleId };
  return input.serverBoundHosts.has(moduleId)
    ? { verdict: 'the-module', moduleId }
    : { verdict: 'the-repository', moduleId };
}

/**
 * Every module a source names, in either spelling.
 *
 * Relative specifiers are matched on the `packages/modules/<id>` segment they
 * carry rather than resolved against the file's directory, because a test under
 * `backend/test` names a package with a path that is already unambiguous and a
 * resolution would need a base the fixtures do not have. Bare specifiers are
 * matched against the layout's name map, longest-prefix by exact segment.
 */
export function ownersOf(
  source: string,
  key: string,
  modulePackageNames: ReadonlyMap<string, string>,
): { readonly owners: string[]; readonly attributions: number } {
  const owners = new Set<string>();
  let attributions = 0;
  for (const specifier of namedSpecifiers(source, key)) {
    const text = specifier.text.split('\\').join('/');
    const relative = /(?:^|\/)packages\/modules\/([^/]+)(?:\/|$)/.exec(text);
    if (relative) {
      owners.add(relative[1]!);
      attributions += 1;
      continue;
    }
    for (const [name, moduleId] of modulePackageNames) {
      if (text === name || text.startsWith(`${name}/`)) {
        owners.add(moduleId);
        attributions += 1;
        break;
      }
    }
  }
  return { owners: [...owners].sort(), attributions };
}

/** One member of the host-composition set: a call name and the file declaring it. */
export interface HostComposer {
  /** The call name a test file writes. */
  readonly name: string;
  /** The file that declares it, relative to the repository root. §7 case 6's subject. */
  readonly declaredIn: string;
}

/**
 * The host-composition set — the calls that make a test file the **host's**.
 *
 * **Three names, and the list is the one every instrument reads** (§1, D-262
 * clause 1). It read one until 2026-09-21, while D-252 stated two and
 * `scripts/extract-paid-module.sh` grepped those two: the premise that the two
 * sides shared a predicate was false in both halves, and two instruments
 * carrying two predicates is worse than either being wrong. Each member is
 * justified in §1's table by what it composes from the host's install, and
 * `setupTestDb` is the third because one call of it awaits `mikroOrmConfig()`,
 * which awaits `configuredEntities()` (`ALL_ENTITIES`, generated about **this**
 * tree) and `configuredMigrations()` — two of the three generated per-host
 * artefacts, where `setupBackendServer` reads all three.
 *
 * `declaredIn` is per member rather than per harness, because the members are
 * not all declared in one file: §7 case 6 requires each declaring file to be at
 * its exact path and to still export its name, so a rename is a refusal rather
 * than a silent reclassification of that member's whole population. The kit's
 * `composeTestServer` is declared in `@endora-commerce/test-kit`'s own source,
 * which `backend/test/helpers/test-server.ts` imports and does not re-export.
 *
 * Widening the list to "anything from `backend/test/helpers/`" is refused in §1
 * of the contract and here: a helper that is not a host composer is
 * `outward-reach`'s question, and the widening would sweep module fixtures such
 * as `backend/test/helpers/unopim-import-fixtures.ts` into the host.
 */
export const HOST_COMPOSERS: readonly HostComposer[] = [
  { name: 'setupBackendServer', declaredIn: 'backend/test/helpers/test-server.ts' },
  { name: 'composeTestServer', declaredIn: 'packages/test-kit/src/server/compose-test-server.ts' },
  { name: 'setupTestDb', declaredIn: 'backend/test/helpers/test-db.ts' },
];

/**
 * Which member of the host-composition set the source calls, or `null`.
 *
 * A call node and not a text match: `test-server.ts` names its own export in
 * prose a dozen times, and a run that counted those would classify the harness
 * as its own caller. The name is returned rather than a boolean so a finding can
 * report the call it actually found.
 */
export function composerCalledBy(source: string, key: string): string | null {
  const sourceFile = ts.createSourceFile(key, source, ts.ScriptTarget.Latest, true);
  const names = new Set(HOST_COMPOSERS.map((composer) => composer.name));
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name !== null && names.has(name)) {
        found = name;
        return;
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return found;
}

/** Whether the source calls any member of the host-composition set. */
export function composesServer(source: string, key: string): boolean {
  return composerCalledBy(source, key) !== null;
}

/**
 * Why the file could not be read, or `null`.
 *
 * `ts.createSourceFile` recovers from a syntax error rather than throwing, so
 * the syntactic diagnostics are what say so; they are reached through a narrow
 * cast because the field is on TypeScript's internal `SourceFile`. If a future
 * TypeScript drops it the cast yields `undefined`, the file reads as parsed, and
 * the escape hatch is the companion test's proof going red.
 */
export function parseFailure(source: string, key: string): string | null {
  const sourceFile = ts.createSourceFile(key, source, ts.ScriptTarget.Latest, true);
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (diagnostics === undefined || diagnostics.length === 0) return null;
  return String(ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, ' '));
}

/**
 * This repository's application roots — §3's last row, all three of them.
 *
 * Written down rather than derived because the rule is about *this* repository's
 * shape: a module package must be testable without any of the three
 * applications, and a fourth arriving is a contract amendment before it is a
 * list edit.
 */
export const APPLICATION_ROOTS: readonly string[] = ['backend', 'admin', 'storefront'];

/**
 * §3's refusals for one specifier written in a module package's test, or `null`.
 *
 * The relative half is **resolved** against the file's directory rather than
 * matched, because `../../../../backend/test/helpers/test-server.js` carries no
 * segment a text rule could key on until it is normalised — and that specifier
 * is the one the whole rule exists for.
 */
export function outwardReachOf(input: {
  readonly specifier: string;
  readonly fileKey: string;
  readonly moduleId: string;
}): string | null {
  const text = input.specifier.split('\\').join('/');
  const target = text.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(input.fileKey), text))
    : text;
  if (/(?:^|\/)dist(?:\/|$)/.test(target)) {
    return `names a build output (\`${text}\`) — a test naming a package's \`dist\` is a second copy of every module-scope value in it`;
  }
  if (!text.startsWith('.')) {
    // A bare specifier resolves through an `exports` map, which is the
    // supported way for one package to name another. Nothing else to refuse.
    return null;
  }
  // The application root is the **leading** segment of a repository-relative
  // path, and the anchor is load-bearing: every module package keeps its own
  // sources under `src/backend/` and its own screens under `src/admin/`, so a
  // rule matching the segment anywhere reports all 211 package tests as reaching
  // the application while none of them does. Measured, on the first run of this
  // check.
  //
  // **Three roots, not one** (§3, D-262 clause 3). The row said `backend/` alone
  // until 2026-09-21 and so did this branch, which left the exact route by which
  // a module's rendered admin case would be "moved into the package" while still
  // pointing at an unpublished React harness under `admin/test/helpers/` — a
  // file that resolves in this checkout and nowhere else, which is the one thing
  // the row exists to refuse.
  const application = APPLICATION_ROOTS.find(
    (root) => target === root || target.startsWith(`${root}/`),
  );
  if (application !== undefined) {
    return `names \`${target}\` — the package must be testable without the application`;
  }
  const sibling = /(?:^|\/)packages\/modules\/([^/]+)(?:\/|$)/.exec(target);
  if (sibling !== null && sibling[1] !== input.moduleId) {
    return `names the sibling package \`${sibling[1]!}\` by relative path (\`${text}\`) — a path specifier is a fact about this checkout's layout and a published package cannot carry one`;
  }
  return null;
}

/** What a `vitest.config.ts` must merge, and where issue #255's guard lives. */
export const BASE_VITEST_CONFIG = 'vitest.config.base';

/** Whether a package's vitest configuration merges the workspace base. */
export function mergesBaseConfig(source: string, key: string): boolean {
  return namedSpecifiers(source, key).some((specifier) =>
    specifier.text.split('\\').join('/').includes(BASE_VITEST_CONFIG),
  );
}

export interface TestOwnershipResult {
  readonly findings: readonly TestOwnershipFinding[];
  /** Shard defects — stale, orphan, empty, misfiled, reasonless, mistyped. */
  readonly ledgerIssues: readonly string[];
  /** Files the walk classified. */
  readonly classified: number;
  /** Owner attributions the walk resolved — the finer population. */
  readonly sites: number;
  /** Scheduled ledger entries standing, i.e. the drain. */
  readonly scheduled: number;
  /** Ledger entries claiming a file is right to stay. */
  readonly retained: number;
  /** Module packages the walk found at least one test file in. */
  readonly packagesWithTests: readonly string[];
  /** Files the table places in a module, by module — for `--list`. */
  readonly misplacedByModule: ReadonlyMap<string, readonly string[]>;
}

/** The remedy printed above each kind's findings. */
export const REMEDIES: Readonly<Record<TestOwnershipFindingKind, string>> = {
  'misplaced-test':
    'This file names exactly one module and boots no server, so it is that module\'s test\n' +
    'and belongs beside its subject at `packages/modules/<id>/src/**/<name>.test.ts`\n' +
    '(contract §2). Move it and rewrite its specifiers to be relative within the package;\n' +
    'if it cannot move yet, add a `scheduled` entry to that module\'s shard under\n' +
    '`backend/scripts/ledgers/test-ownership/` naming the batch that retires it.',
  'harness-bound-move':
    'This file is inside a module package and composes a test server. The only composer in\n' +
    'this checkout is `backend/test/helpers/test-server.ts`, which contract §3 refuses a\n' +
    'package to name, so the file cannot run from the package it sits in. Move it back to\n' +
    '`backend/test/` until `@endora-commerce/test-kit` exists\n' +
    '(`specs/109-backend-test-kit/`, R5.3).',
  'unconfigured-package-tests':
    'This package ships test files that nothing runs. It needs a `test` script in its own\n' +
    '`package.json` and a `vitest.config.ts` that `mergeConfig`s `vitest.config.base.ts` —\n' +
    'the base is where issue #255\'s foreign-workspace-link refusal lives, so a\n' +
    'configuration that skips it can execute another checkout\'s sources while reporting on\n' +
    'this branch. Never add `--passWithNoTests`.',
  'outward-reach':
    'Contract §3. A module package\'s test may name its own package relatively, the\n' +
    'published contracts and platform surface, and a sibling module by **bare** specifier.\n' +
    'It may not name `backend/`, a sibling by relative path, or any `dist`.',
  'unclassifiable-test':
    'The analysis could not read this file, so it has no verdict. It is a finding rather\n' +
    'than a skip (issue #113): reading an unreadable file as the repository\'s would agree\n' +
    'with the defect, since the repository is where an unmoved file already is.',
};

/** The whole rule, over inputs a fixture can supply in full. */
export function checkTestOwnership(input: TestOwnershipInput): TestOwnershipResult {
  const findings: TestOwnershipFinding[] = [];
  const misplacedByModule = new Map<string, string[]>();
  // The **walk's** answer to "which packages have tests", not the classifier's:
  // a package whose only test file is unparseable still has one, and deriving
  // this from the classified files would turn that finding into a coverage
  // shortfall — exit 2 masking the exit 1 it exists to report.
  const packagesWithTests = new Set(
    input.packages.filter((pkg) => pkg.testFiles > 0).map((pkg) => pkg.moduleId),
  );
  let classified = 0;
  let sites = 0;

  for (const file of input.files) {
    const failure = parseFailure(file.text, file.key);
    if (failure !== null) {
      findings.push({
        kind: 'unclassifiable-test',
        moduleId: file.moduleId,
        file: file.key,
        detail: failure,
      });
      continue;
    }
    classified += 1;

    if (file.root === 'module-package') {
      const moduleId = file.moduleId;
      if (moduleId !== null) {
        for (const specifier of namedSpecifiers(file.text, file.key)) {
          const reach = outwardReachOf({
            specifier: specifier.text,
            fileKey: file.key,
            moduleId,
          });
          if (reach !== null) {
            findings.push({
              kind: 'outward-reach',
              moduleId,
              file: file.key,
              detail: `line ${specifier.line}: ${reach}`,
            });
          }
        }
        const composer = composerCalledBy(file.text, file.key);
        if (composer !== null && !input.serverBoundHosts.has(moduleId)) {
          findings.push({
            kind: 'harness-bound-move',
            moduleId,
            file: file.key,
            detail: `calls \`${composer}(\` from inside \`${moduleId}\`'s package, which cannot host a server-bound test in this checkout`,
          });
        }
      }
      continue;
    }

    const attributed = ownersOf(file.text, file.key, input.modulePackageNames);
    sites += attributed.attributions;
    const verdict = ownershipOf({
      owners: attributed.owners,
      composesServer: composesServer(file.text, file.key),
      serverBoundHosts: input.serverBoundHosts,
    });
    if (verdict.verdict !== 'the-module' || verdict.moduleId === null) continue;
    const moduleId = verdict.moduleId;
    const list = misplacedByModule.get(moduleId) ?? [];
    list.push(file.key);
    misplacedByModule.set(moduleId, list);
  }

  // The ledger, in `check:module-boundary`'s shape.
  const byModule = new Map<string, TestOwnershipLedgerShard>();
  const ledgerIssues: string[] = [];
  let scheduled = 0;
  let retained = 0;
  const registered = new Set(input.packages.map((pkg) => pkg.moduleId));

  for (const shard of input.ledger) {
    byModule.set(shard.moduleId, shard);
    const keys = Object.keys(shard.entries);
    if (keys.length === 0) {
      ledgerIssues.push(
        `${shard.moduleId}: the shard is empty — delete the file rather than leaving a done signal that says nothing`,
      );
    }
    if (!registered.has(shard.moduleId)) {
      ledgerIssues.push(
        `${shard.moduleId}: no module package of that id exists — an orphan shard is a ledger nothing can drain`,
      );
    }
    if (shard.source !== undefined) {
      const declared = declaredEntryType(shard.source);
      if (declared !== CANONICAL_SHARD_ENTRY_TYPE) {
        ledgerIssues.push(
          `${shard.moduleId}: declares \`${declared ?? '<nothing>'}\` — a shard must declare \`${CANONICAL_SHARD_ENTRY_TYPE}\`, or a field this check reads is a type error in it (issue #217)`,
        );
      }
    }
    for (const [key, entry] of Object.entries(shard.entries)) {
      if (reasonOf(entry).trim().length === 0) {
        ledgerIssues.push(`${shard.moduleId}: ${key} carries no reason`);
      }
      if (isScheduled(entry)) {
        scheduled += 1;
        if (entry.retiredBy.trim().length === 0) {
          ledgerIssues.push(
            `${shard.moduleId}: ${key} is scheduled and names no batch — \`retiredBy\` is what makes \`scheduled=\` a drain rather than a heap`,
          );
        }
      } else {
        retained += 1;
      }
      const owner = misplacedOwnerOf(key, misplacedByModule);
      if (owner === null) {
        ledgerIssues.push(
          `${shard.moduleId}: ${key} describes no misplaced test — a stale entry fails as loudly as an unledgered file`,
        );
      } else if (owner !== shard.moduleId) {
        ledgerIssues.push(
          `${shard.moduleId}: ${key} is \`${owner}\`'s file and is filed under this shard`,
        );
      }
    }
  }

  for (const [moduleId, files] of misplacedByModule) {
    const shard = byModule.get(moduleId);
    for (const file of files) {
      if (shard !== undefined && file in shard.entries) continue;
      findings.push({
        kind: 'misplaced-test',
        moduleId,
        file,
        detail: `names \`${moduleId}\` and no other module, and boots no server`,
      });
    }
  }

  for (const pkg of input.packages) {
    if (pkg.testFiles === 0) continue;
    const reasons: string[] = [];
    if (pkg.testScript === null) reasons.push('no `test` script in its `package.json`');
    if (pkg.vitestConfig === null) reasons.push('no `vitest.config.ts`');
    else if (!mergesBaseConfig(pkg.vitestConfig, `${pkg.key}/vitest.config.ts`)) {
      reasons.push('a `vitest.config.ts` that does not merge `vitest.config.base.ts`');
    }
    if (reasons.length === 0) continue;
    findings.push({
      kind: 'unconfigured-package-tests',
      moduleId: pkg.moduleId,
      file: pkg.key,
      detail: `ships ${pkg.testFiles} test file(s) with ${reasons.join(' and ')}`,
    });
  }

  return {
    findings,
    ledgerIssues,
    classified,
    sites,
    scheduled,
    retained,
    packagesWithTests: [...packagesWithTests].sort(),
    misplacedByModule,
  };
}

/** The module a ledger key names, or `null` when the walk found no such file. */
function misplacedOwnerOf(
  key: string,
  misplacedByModule: ReadonlyMap<string, readonly string[]>,
): string | null {
  for (const [moduleId, files] of misplacedByModule) {
    if (files.includes(key)) return moduleId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exit 2 — §7
// ---------------------------------------------------------------------------

export type VacuousReasonKind =
  | 'no-application-test-file'
  | 'no-package-test-file'
  | 'no-owner-attribution'
  | 'no-package-test-script'
  | 'missing-ledger-directory'
  | 'harness-not-found';

export interface VacuousReason {
  readonly kind: VacuousReasonKind;
  readonly message: string;
}

export interface VacuousInput {
  /** Test files the walk opened under `backend/test/`. */
  readonly applicationFiles: number;
  /** Test files the walk opened under the module walk roots. */
  readonly packageFiles: number;
  /** Owner attributions the walk resolved. */
  readonly attributions: number;
  /** Module packages declaring a `test` script. */
  readonly packagesDeclaringTests: number;
  /** Whether the ledger directory exists — empty is fine, absent is not. */
  readonly ledgerDirectoryExists: boolean;
  /**
   * Each host composer's declaring source at its exact path, keyed by the
   * composer's name, `null` where the file is not there.
   *
   * A record and not one string: §7 case 6's refusal applies to **every** member
   * of {@link HOST_COMPOSERS} (D-262 clause 1), and the members are declared in
   * different files, so one source could not be the subject of all three.
   */
  readonly composerSources: Readonly<Record<string, string | null>>;
}

/**
 * Why this run may not report a verdict, or `null`.
 *
 * Pure and over the record the host hands in, so a red proof enters where a real
 * run enters (issue #130). The order is the order a reader needs: the two
 * addends of the union first, because a union whose addends are not separately
 * floored hides the one that went to zero.
 */
export function vacuousTestOwnership(input: VacuousInput): VacuousReason | null {
  if (input.applicationFiles === 0) {
    return {
      kind: 'no-application-test-file',
      message:
        'the walk opened no test file under `backend/test/` — that root holds the large ' +
        'majority of this repository\'s tests, and a union whose addends are not separately ' +
        'floored reports the other half clean',
    };
  }
  if (input.packageFiles === 0) {
    return {
      kind: 'no-package-test-file',
      message:
        'the walk opened no test file in any module package — `harness-bound-move`, ' +
        '`outward-reach` and `unconfigured-package-tests` all have that root as their ' +
        'whole population, so all three are vacuously clean',
    };
  }
  if (input.attributions === 0) {
    return {
      kind: 'no-owner-attribution',
      message:
        'the walk resolved no owner at all — every file reads as the repository\'s and the ' +
        'ownership table never fires, which is issue #237\'s shape: the file count stands ' +
        'still while the syntax walk goes blind',
    };
  }
  if (input.packagesDeclaringTests === 0) {
    return {
      kind: 'no-package-test-script',
      message:
        'no module package declares a `test` script — the independent author of §6\'s ' +
        'reconciliation has lost its subject, so the walk is corroborated by nothing',
    };
  }
  if (!input.ledgerDirectoryExists) {
    return {
      kind: 'missing-ledger-directory',
      message:
        'the ledger directory is not there — an *empty* ledger is a clean tree and a ' +
        'missing one is a run that could not read the baseline it judges against',
    };
  }
  // Every member, in order, and not only the first: a member whose declaring
  // file moved or whose name changed stops matching silently, and its own
  // population — 51 ledgered files for `setupTestDb` — reclassifies at once.
  for (const composer of HOST_COMPOSERS) {
    const source = input.composerSources[composer.name] ?? null;
    if (source === null) {
      return {
        kind: 'harness-not-found',
        message:
          `\`${composer.declaredIn}\` is not at its exact path — it declares ` +
          `\`${composer.name}\`, a member of the \`composesServer\` predicate, and a harness ` +
          'that moved must be a refusal rather than a reclassification of every file that ' +
          'calls it',
      };
    }
    if (!new RegExp(`export\\s+(?:async\\s+)?function\\s+${composer.name}\\b`).test(source)) {
      return {
        kind: 'harness-not-found',
        message:
          `\`${composer.declaredIn}\` no longer exports \`${composer.name}\` — the predicate ` +
          'has lost one of its subjects and every file composing through it would ' +
          'reclassify at once',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The repository host
// ---------------------------------------------------------------------------

const PRUNED = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.turbo']);

/** Every `.test.ts` / `.test.tsx` under `dir`. */
export function testFilesUnder(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (directory) {
      if (PRUNED.has(entry)) continue;
      testFilesUnder(full, out);
      continue;
    }
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * Modules able to host a server-bound test — 109 R5.1, derived and empty.
 *
 * The derivation, in full: a module package may host one when it can call a
 * member of {@link HOST_COMPOSERS} without an `outward-reach`. Two of the three
 * are declared under `backend/` — `test/helpers/test-server.ts` and
 * `test/helpers/test-db.ts` — and contract §3 refuses a package naming
 * `backend/`, so neither is reachable. The third, the kit's `composeTestServer`,
 * is published surface and *is* nameable, and that is precisely the seam
 * `specs/109-backend-test-kit/`'s Phase 4 opens rather than a capability this
 * checkout has: until it lands no module package declares the kit, the set is
 * empty, and a package calling that member today is the `harness-bound-move`
 * this check reports. It is written as a function
 * over the layout rather than as a constant because that is the seam
 * `specs/109-backend-test-kit/`'s Phase 4 widens — to the modules declaring
 * `@endora-commerce/test-kit` and the closure §6 derives — and because a
 * constant folded into {@link ownershipOf} would make the flipped cell
 * unprovable.
 */
export function serverBoundHosts(_layout: ModuleTreeLayout): ReadonlySet<string> {
  return new Set<string>();
}

interface LoadedLedger {
  readonly shards: readonly TestOwnershipLedgerShard[];
  readonly directoryExists: boolean;
}

async function loadLedger(directory: string): Promise<LoadedLedger> {
  let entries: string[];
  try {
    entries = readdirSync(directory).filter((name) => name.endsWith('.ts')).sort();
  } catch {
    return { shards: [], directoryExists: false };
  }
  const shards: TestOwnershipLedgerShard[] = [];
  for (const name of entries) {
    const full = join(directory, name);
    const loaded = (await import(pathToFileURL(full).href)) as {
      entries?: Readonly<Record<string, TestOwnershipLedgerEntry>>;
    };
    shards.push({
      moduleId: name.replace(/\.ts$/, ''),
      entries: loaded.entries ?? {},
      source: readFileSync(full, 'utf8'),
    });
  }
  return { shards, directoryExists: true };
}

function readPackage(directory: string): { readonly testScript: string | null } {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = manifest.scripts?.test;
    return { testScript: typeof script === 'string' ? script : null };
  } catch {
    return { testScript: null };
  }
}

/**
 * The workspace member that owns a module's directory — the nearest ancestor
 * holding a `package.json`, `repoRoot` included as the stop.
 *
 * The configuration question this check asks (*does anything run these test
 * files?*) is answered by a **member**, never by the module's own directory:
 * `test` scripts and `vitest.config.ts` are a manifest's, and only a module that
 * *is* a package has one of its own. `_lifecycle` is the case that proves it —
 * a registered module that is deliberately not a package (D-160.11), whose
 * sources are `@endora-commerce/platform`'s at `packages/platform/src/lifecycle`
 * — and `specs/110-instance-repository/` T119a is when it acquired co-located
 * tests. Reading the module directory reported it as shipping five test files
 * nothing runs, while `packages/platform/package.json`'s `test` script was
 * running them all along. A core module still under the application's own source
 * root resolves to `backend` on the same walk, which is the right answer there
 * too.
 */
function owningMemberOf(directory: string, repoRoot: string): string {
  let current = directory;
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current || current === repoRoot) return directory;
    current = parent;
  }
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const backendRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
  const keyOf = (path: string): string =>
    relative(layout.repoRoot, path).split('\\').join('/');

  // §7 case 2, asked **first**, so a moved module tree is named as one rather
  // than answered "the walk opened no test file". The unit is the module's own
  // directory rather than a test file, because a module legitimately ships no
  // test at all — 14 of the 70 do — and a floor over test files would refuse
  // every clean run. It is `check:bundle-pairing`'s conjunction: the layout must
  // *place* the module (which sees the half-moved tree, sources at a package
  // address with the `package.json` withheld) and that directory must exist
  // (which sees the moved tree, where every module is placed at a directory that
  // is not there).
  const directories = [...layout.moduleDirectories].filter(([, directory]) => {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  });
  const byDirectory = new Map(directories.map(([moduleId, directory]) => [directory, moduleId]));
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: directories.map(([, directory]) => directory),
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  const files: TestFileUnderCheck[] = [];
  const applicationTestRoot = join(backendRoot, 'test');
  for (const path of testFilesUnder(applicationTestRoot)) {
    const text = readIfPresent(path);
    if (text === null) continue;
    files.push({ key: keyOf(path), text, root: 'application', moduleId: null });
  }
  const applicationFiles = files.length;

  const packages: PackageUnderCheck[] = [];
  for (const [moduleId, directory] of directories) {
    const found = testFilesUnder(directory);
    for (const path of found) {
      const text = readIfPresent(path);
      if (text === null) continue;
      files.push({ key: keyOf(path), text, root: 'module-package', moduleId });
    }
    const member = owningMemberOf(directory, layout.repoRoot);
    packages.push({
      moduleId,
      key: keyOf(directory),
      testFiles: found.length,
      testScript: readPackage(member).testScript,
      vitestConfig: readIfPresent(join(member, 'vitest.config.ts')),
    });
  }
  const packageFiles = files.length - applicationFiles;

  const ledger = await loadLedger(join(backendRoot, 'scripts', 'ledgers', 'test-ownership'));
  const composerSources = Object.fromEntries(
    HOST_COMPOSERS.map((composer) => [
      composer.name,
      readIfPresent(join(layout.repoRoot, composer.declaredIn)),
    ]),
  );

  const hosts = serverBoundHosts(layout);
  const attributions = files
    .filter((file) => file.root === 'application')
    .reduce(
      (total, file) =>
        total + ownersOf(file.text, file.key, layout.modulePackageNames).attributions,
      0,
    );

  const vacuous = vacuousTestOwnership({
    applicationFiles,
    packageFiles,
    attributions,
    packagesDeclaringTests: packages.filter((pkg) => pkg.testScript !== null).length,
    ledgerDirectoryExists: ledger.directoryExists,
    composerSources,
  });
  if (vacuous !== null) {
    console.error(`${PREFIX} ${vacuous.message}; refusing to report a vacuous pass`);
    process.exit(2);
  }

  const result = checkTestOwnership({
    files,
    packages,
    modulePackageNames: layout.modulePackageNames,
    serverBoundHosts: hosts,
    ledger: ledger.shards,
  });

  if (listMode) {
    for (const [moduleId, misplaced] of [...result.misplacedByModule].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      console.log(`${String(misplaced.length).padStart(4)}  ${moduleId}`);
    }
    console.log('');
  }

  const declaringTests = packages.filter((pkg) => pkg.testScript !== null);
  reportReadSize({
    prefix: PREFIX,
    files: files.length,
    // The finer population is the **owner attributions**, not the classified
    // files: a batch moves a file from `backend/test` into its package and the
    // total stands still while its specifiers stop naming that package, so a
    // per-file `sites` could never move independently of `files` and would say
    // the same thing twice. It is also where this check goes blind — an owner
    // resolver that stopped matching either spelling reads every file as the
    // platform's while the file count is untouched (issue #237's shape).
    sites: result.sites,
    coverage: [
      coverage,
      // The independent author: the packages' own manifests answering "which
      // packages have tests", against the packages this walk found one in.
      {
        source: 'package-test-scripts',
        expected: declaringTests.length,
        covered: declaringTests.filter((pkg) =>
          result.packagesWithTests.includes(pkg.moduleId),
        ).length,
      },
    ],
  });
  console.log(
    `${PREFIX} application=${applicationFiles} packages=${packageFiles} ` +
      `ledger-size=${result.scheduled + result.retained} ` +
      `(scheduled=${result.scheduled} retained=${result.retained}) ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0 && result.ledgerIssues.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const owner = finding.moduleId === null ? '' : `${finding.moduleId}: `;
      console.error(`  - ${owner}${finding.file}\n      ${finding.detail}`);
    }
  }
  if (result.ledgerIssues.length > 0) {
    console.error(
      '\n[ledger]\nThe ledger is two-way: an unledgered file fails, and so does an entry that no\n' +
        'longer describes one. Delete the entry in the merge request that moved the file.\n',
    );
    for (const issue of result.ledgerIssues) console.error(`  - ${issue}`);
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
