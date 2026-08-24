/**
 * The acceptance criterion's judgements, with nothing that touches a network,
 * a database or a package manager.
 *
 * Everything here is a pure function over values the runner collects, so the
 * two assertions that carry the contract — A8 (no symlink leaves the instance)
 * and A9 (the moved-directory case must NOT satisfy A8) — are drivable from a
 * unit test over a real directory tree, entering at the top of the analysis
 * (issue #130): the test builds the symlinks on disk and calls
 * {@link classifyResolutionPath}, which is the same function the runner calls
 * on a real `pnpm add`.
 *
 * Contract: `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.
 */

import { realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The assertions, in order: A1 … A9 are the ones the contract states, A10 is
 * this repository's own and is ahead of it.
 *
 * **A10 is not a schema assertion, and it is here rather than in a test of its
 * own for the reason T053(c) gives**: the thing it needs is an installed
 * package — packed, installed outside the repository, composed — and this
 * harness is the only place that exists. Building a second one to ask one
 * question would be a second answer to "what is an installed package"; asking
 * it here costs one phase.
 *
 * What it asks is the overlay pattern's, not the packaging programme's: a
 * per-deployment overlay overrides a core service by decorating the
 * **registration** (feature 072, D-28), and a registration name says nothing
 * about where its owner's code lives. So an owner that has become a package
 * ought to be transparent to a decoration. Nothing measured that, and the
 * decoration exemption an overlay module holds (`overlay: true`, set from the
 * root it was discovered under — issue #203) is exactly the kind of thing that
 * can turn out to depend on where the *wrapped* module lives.
 */
export const ASSERTION_IDS = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
] as const;
export type AssertionId = (typeof ASSERTION_IDS)[number];

/**
 * `pass` / `fail` are answers about the **platform**. `inconclusive` is an
 * answer about the **harness** — a service that was not reachable, a tool that
 * was not installed, a step that never ran — and it is a separate word on
 * purpose: a criterion that reports a red it did not measure is as useless as
 * one that reports a green it did not measure.
 */
export type AssertionStatus = 'pass' | 'fail' | 'inconclusive';

export interface AssertionResult {
  readonly id: AssertionId;
  readonly title: string;
  /** What this assertion refuses — printed beside every result, red or green. */
  readonly refuses: string;
  readonly status: AssertionStatus;
  readonly detail: string;
}

/** One symlinked segment on a resolution path, and where it actually points. */
export interface SymlinkHop {
  readonly at: string;
  readonly target: string;
  /** Does following it leave the instance directory? */
  readonly leavesInstance: boolean;
}

/**
 * What a resolved package path really is, once every symlink on it is followed.
 *
 * **Why this is not "contains no symlink".** pnpm's isolated node-linker — the
 * default, and the layout a real instance has — always makes
 * `node_modules/<name>` a symlink into `node_modules/.pnpm/<name>@<v>/…`. A
 * literal "no symlink anywhere" test therefore refuses a correct install and
 * would have to be switched off, which is how an anti-trap assertion becomes
 * decoration. The property that actually distinguishes an installed package
 * from a linked directory is where the links *land*: inside the instance, or
 * back in the repository working tree.
 */
export interface ResolutionPathFinding {
  /** The path as resolved, symlinks and all. */
  readonly resolved: string;
  /** `fs.realpath` of it. */
  readonly real: string;
  /** Every symlinked segment between the instance root and the package. */
  readonly hops: readonly SymlinkHop[];
  /** Does the real path stay under `<instance>/node_modules/`? */
  readonly containedByInstance: boolean;
  /** Does the real path land inside the repository working tree? */
  readonly reachesRepository: boolean;
}

function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Follow the resolved path segment by segment, recording every symlink.
 *
 * Walks from the instance root downwards rather than calling `realpath` once,
 * because "the resolution path holds a link into the repository" is a statement
 * about the segments: a single `realpath` of the leaf answers where it ended up
 * and never says which hop took it there, and that hop is what an author has to
 * be told about.
 */
export function classifyResolutionPath(input: {
  /** Absolute path of the resolved `package.json` (or the package directory). */
  readonly resolved: string;
  /** The throwaway instance directory the package was installed into. */
  readonly instanceRoot: string;
  /** The repository working tree the package must not lead back into. */
  readonly repositoryRoot: string;
}): ResolutionPathFinding {
  const resolved = resolve(input.resolved);
  const instanceRoot = realpathSync(resolve(input.instanceRoot));
  const repositoryRoot = realpathSync(resolve(input.repositoryRoot));

  const hops: SymlinkHop[] = [];
  const segments = relative(instanceRoot, resolved).split(sep).filter((s) => s.length > 0);
  let cursor = instanceRoot;
  for (const segment of segments) {
    cursor = resolve(cursor, segment);
    let link: string | null = null;
    try {
      if (lstatSync(cursor).isSymbolicLink()) link = readlinkSync(cursor);
    } catch {
      // A segment that does not exist is not a symlink; the caller's own
      // existence check is what reports a package that was never installed.
      break;
    }
    if (link === null) continue;
    const target = realpathSync(cursor);
    hops.push({ at: cursor, target, leavesInstance: !isUnder(target, instanceRoot) });
    cursor = target;
  }

  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    // Reported by `containedByInstance` below rather than thrown: a path that
    // does not resolve is a failed install, which is a `fail`, not a crash.
  }

  return {
    resolved,
    real,
    hops,
    containedByInstance: isUnder(real, instanceRoot),
    reachesRepository: isUnder(real, repositoryRoot),
  };
}

/** The instance directory itself must not sit inside the repository. */
export function instanceIsOutsideRepository(
  instanceRoot: string,
  repositoryRoot: string,
): boolean {
  return !isUnder(realpathSync(resolve(instanceRoot)), realpathSync(resolve(repositoryRoot)));
}

/**
 * A8 — the anti-trap assertion.
 *
 * Passes only when the installed package's resolution path stays inside the
 * throwaway instance: no hop leaves it, the real path is under it, and it does
 * not land in the repository working tree. A workspace link, a `file:` link and
 * a moved directory each fail at least one of the three.
 */
export function evaluateA8(finding: ResolutionPathFinding): AssertionResult {
  const escaping = finding.hops.filter((hop) => hop.leavesInstance);
  const parts: string[] = [];
  if (escaping.length > 0) {
    parts.push(
      `${escaping.length} symlink(s) leave the instance: ` +
        escaping.map((hop) => `${hop.at} -> ${hop.target}`).join('; '),
    );
  }
  if (!finding.containedByInstance) {
    parts.push(`realpath ${finding.real} is not under the instance`);
  }
  if (finding.reachesRepository) {
    parts.push(`realpath ${finding.real} lands inside the repository working tree`);
  }
  const contained = finding.hops.filter((hop) => !hop.leavesInstance).length;
  return {
    id: 'A8',
    title: 'No symlink leaves the instance on the package resolution path',
    refuses: 'a package consumed from the repository — a workspace link, a `file:` link or a moved directory',
    status: parts.length === 0 ? 'pass' : 'fail',
    detail:
      parts.length === 0
        ? `realpath ${finding.real} stays under the instance; ` +
          `${contained} internal symlink hop(s) (pnpm's own store layout), none leaving it`
        : parts.join('. '),
  };
}

/**
 * A9 — the criterion has to be able to say no.
 *
 * Runs A8's predicate over the same package consumed the way F4's own wording
 * invites — a directory inside the repository, linked rather than installed —
 * and passes only when that comes back **false**. Without it, A8 is a claim
 * nobody has ever seen refuse anything.
 */
export function evaluateA9(
  movedFinding: ResolutionPathFinding,
  movedIsOtherwiseUsable: boolean,
): AssertionResult {
  const a8OverMoved = evaluateA8(movedFinding);
  const refusedForTheRightReason = movedFinding.reachesRepository;
  if (!movedIsOtherwiseUsable) {
    return {
      id: 'A9',
      title: 'The moved-directory case does not satisfy A8',
      refuses: 'an A8 that has never been seen to refuse anything',
      status: 'inconclusive',
      detail:
        'the moved-directory package did not resolve at all, so it never reached the state ' +
        'A8 would otherwise have accepted — A9 proves nothing about A8 in that state',
    };
  }
  return {
    id: 'A9',
    title: 'The moved-directory case does not satisfy A8',
    refuses: 'an A8 that has never been seen to refuse anything',
    status: a8OverMoved.status === 'fail' && refusedForTheRightReason ? 'pass' : 'fail',
    detail:
      a8OverMoved.status === 'fail' && refusedForTheRightReason
        ? `A8 refuses the moved case: ${a8OverMoved.detail}`
        : `A8 accepted the moved case (or refused it for an unrelated reason): ${a8OverMoved.detail}. ` +
          'A8 cannot distinguish an installed package from a linked directory, which is the whole contract.',
  };
}

/**
 * The disposable-database convention, shared with the dev-seed guard and the
 * test harness rather than re-invented: a name this does not accept is one the
 * runner refuses to create, drop or migrate.
 */
export const TEST_DATABASE_NAME_PATTERN = /(^|_)test(_|$)/;

export interface DatabaseTarget {
  readonly adminUrl: string;
  readonly databaseUrl: string;
  readonly databaseName: string;
}

/**
 * Split a DSN into "the database to build" and "a maintenance connection", and
 * refuse anything the convention above does not call disposable.
 *
 * This runner creates and drops a database; the guard is therefore the same
 * question `pnpm seed:dev` asks, with the loopback arm removed. A local
 * developer's own `b2b` database is reachable over loopback and is exactly the
 * thing that must not be dropped by an acceptance run.
 */
export function resolveDatabaseTarget(dsn: string): DatabaseTarget | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return { error: `not a URL: ${dsn}` };
  }
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (databaseName === '') return { error: 'the DSN names no database' };
  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    return {
      error:
        `database "${databaseName}" is not a disposable one — this runner drops and ` +
        're-creates the database it migrates, so its name must contain "test" ' +
        '(the convention test/global-setup.ts and the dev-seed guard both use)',
    };
  }
  const admin = new URL(dsn);
  admin.pathname = '/postgres';
  return { adminUrl: admin.toString(), databaseUrl: dsn, databaseName };
}

/**
 * What each assertion is, independently of any run.
 *
 * Written down here so a report can name an assertion **no phase answered**.
 * An id missing from the output is the one shape of vacuous result this whole
 * file exists to prevent, and it cannot be reported without a title to report
 * it under.
 */
export const ASSERTION_CATALOGUE: Readonly<
  Record<AssertionId, { readonly title: string; readonly refuses: string }>
> = {
  A1: {
    title: 'mikro_orm_migrations carries the package migration',
    refuses: 'a package whose migration the host never even saw',
  },
  A2: {
    title: 'information_schema knows the package table',
    refuses: 'a migration that was recorded without being run',
  },
  A3: {
    title: "the table's tenant column and index are as the migration declared them",
    refuses: 'a row in `mikro_orm_migrations` standing in for a body that never ran',
  },
  A4: {
    title: 'the ORM can query the package entity',
    refuses: "a `dist` whose `__decorate([...])` never reached the host's entity registry",
  },
  A5: {
    title: 'identity, permission, translations and enforcement travel with the package',
    refuses: 'a package whose schema arrives while the rest of it does not',
  },
  A6: {
    title: 'the activation control switches the package off and back on',
    refuses: 'a package that is not an ordinary lifecycle participant (Principle XVII)',
  },
  A7: {
    title: "a hard uninstall reverts exactly the package's migration",
    refuses: 'a package whose schema the host cannot give back',
  },
  A8: {
    title: 'no symlink leaves the instance on the package resolution path',
    refuses: 'a package consumed from the repository rather than installed from an artefact',
  },
  A9: {
    title: 'the moved-directory case does not satisfy A8',
    refuses: 'an A8 that has never been seen to refuse anything',
  },
  A10: {
    title: "a deployment's overlay decorates a registration the installed package owns",
    refuses:
      'an overlay pattern whose one customisation seam reaches only the modules this repository ships',
  },
};

const STATUS_RANK: Record<AssertionStatus, number> = { pass: 0, fail: 1, inconclusive: 2 };

/**
 * One result per assertion id, from however many phases spoke about it.
 *
 * Two assertions are answered by more than one phase — A5 by the manifest probe
 * and by the composed application, A6 by the off boot and the on boot — so the
 * worst answer wins and every detail is kept. `inconclusive` outranks `fail`:
 * a partly unmeasured assertion cannot be reported as a finished red, which
 * would be a claim about the platform that the run did not make.
 */
export function mergeResults(
  results: readonly AssertionResult[],
  inconclusiveReasons: readonly string[] = [],
): AssertionResult[] {
  const merged = new Map<AssertionId, AssertionResult>();
  for (const result of results) {
    const previous = merged.get(result.id);
    if (!previous) {
      merged.set(result.id, result);
      continue;
    }
    const worst =
      STATUS_RANK[result.status] > STATUS_RANK[previous.status] ? result.status : previous.status;
    merged.set(result.id, {
      id: result.id,
      title: ASSERTION_CATALOGUE[result.id].title,
      refuses: ASSERTION_CATALOGUE[result.id].refuses,
      status: worst,
      // Two phases that answer the same way about the same id say it once: the
      // duplicate is noise in the one place the report has to be read closely.
      detail:
        previous.detail === result.detail
          ? previous.detail
          : `${previous.detail} | ${result.detail}`,
    });
  }
  return ASSERTION_IDS.map(
    (id) =>
      merged.get(id) ?? {
        id,
        title: ASSERTION_CATALOGUE[id].title,
        refuses: ASSERTION_CATALOGUE[id].refuses,
        status: 'inconclusive' as const,
        detail:
          inconclusiveReasons.length > 0
            ? `no phase answered; ${inconclusiveReasons.join('; ')}`
            : 'no phase answered, and no phase said why — this is a harness defect, not a verdict',
      },
  );
}

/**
 * The run's exit code.
 *
 *   0 — every assertion was evaluated and passed.
 *   1 — the criterion is red: something was measured and the platform failed it.
 *   2 — nothing, or not everything, could be measured. Never a green.
 *
 * The third one is the repository's rule about vacuous results applied to an
 * acceptance criterion: "PostgreSQL was unreachable" must not be spellable as
 * either colour.
 */
export function exitCodeFor(results: readonly AssertionResult[]): 0 | 1 | 2 {
  const seen = new Set(results.map((r) => r.id));
  if (ASSERTION_IDS.some((id) => !seen.has(id))) return 2;
  if (results.some((r) => r.status === 'inconclusive')) return 2;
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The expectation ledger
// ---------------------------------------------------------------------------

/**
 * What the criterion is expected to answer **today**, per assertion, with the
 * reason for every answer that is not `pass`.
 *
 * What CI enforces is the **two-way ratchet** this repository uses everywhere
 * else: the run must answer exactly what the committed file says, and drift in
 * either direction fails. It was written while the criterion was red by
 * construction — a package genuinely could not ship schema until Wave 3, and a
 * job that simply failed on the red would have blocked every merge request
 * touching a migration registry — and it is unchanged now that all nine pass
 * (T046). Only the direction that bites has moved: a newly-red assertion fails
 * the job, and a newly-green one still would, its remedy being to record the
 * green in the merge request that earned it.
 *
 * Never edit an entry to make a pipeline pass. Either the platform changed —
 * and the entry moves with it — or something is broken.
 */
export interface AcceptanceExpectation {
  readonly [id: string]: { readonly status: 'pass' | 'fail'; readonly reason: string };
}

export interface ExpectationDrift {
  readonly id: string;
  readonly expected: 'pass' | 'fail';
  readonly actual: AssertionStatus;
  readonly detail: string;
}

export interface ExpectationComparison {
  readonly drift: readonly ExpectationDrift[];
  /** Ledger problems: an id nobody expects, an expectation nobody measures. */
  readonly ledgerErrors: readonly string[];
  readonly unmeasured: readonly AssertionResult[];
}

export function compareToExpectation(
  results: readonly AssertionResult[],
  expectation: AcceptanceExpectation,
): ExpectationComparison {
  const drift: ExpectationDrift[] = [];
  const ledgerErrors: string[] = [];
  const unmeasured: AssertionResult[] = [];

  for (const id of Object.keys(expectation)) {
    if (!(ASSERTION_IDS as readonly string[]).includes(id)) {
      ledgerErrors.push(`the expectation names "${id}", which is not an assertion of this criterion`);
    }
    const entry = expectation[id];
    if (entry && entry.status === 'fail' && entry.reason.trim().length === 0) {
      ledgerErrors.push(`the expectation records ${id} as failing and gives no reason`);
    }
  }

  for (const result of results) {
    const entry = expectation[result.id];
    if (!entry) {
      ledgerErrors.push(
        `${result.id} is measured and unaccounted for — add it to the expectation with a reason`,
      );
      continue;
    }
    if (result.status === 'inconclusive') {
      unmeasured.push(result);
      continue;
    }
    if (result.status !== entry.status) {
      drift.push({
        id: result.id,
        expected: entry.status,
        actual: result.status,
        detail: result.detail,
      });
    }
  }
  return { drift, ledgerErrors, unmeasured };
}

/** The ratchet run's exit code: 0 no drift, 1 drift, 2 anything unmeasured. */
export function exitCodeForExpectation(comparison: ExpectationComparison): 0 | 1 | 2 {
  if (comparison.ledgerErrors.length > 0 || comparison.unmeasured.length > 0) return 2;
  return comparison.drift.length > 0 ? 1 : 0;
}

/** The report, as the CI job's log shows it. */
export function formatReport(
  results: readonly AssertionResult[],
  notes: readonly string[],
): string {
  const lines: string[] = [];
  for (const note of notes) lines.push(`[acceptance] note: ${note}`);
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const id of ASSERTION_IDS) {
    const result = byId.get(id);
    if (!result) {
      lines.push(`[acceptance] ${id} NOT EVALUATED`);
      continue;
    }
    const mark =
      result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'INCONCLUSIVE';
    lines.push(`[acceptance] ${id} ${mark} — ${result.title}`);
    lines.push(`[acceptance]      refuses: ${result.refuses}`);
    lines.push(`[acceptance]      ${result.detail}`);
  }
  const counts = {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    inconclusive: results.filter((r) => r.status === 'inconclusive').length,
  };
  lines.push(
    `[acceptance] read: assertions=${results.length}/${ASSERTION_IDS.length} ` +
      `pass=${counts.pass} fail=${counts.fail} inconclusive=${counts.inconclusive}`,
  );
  return lines.join('\n');
}

/** Where the fixture package's sources live, from this file. */
export function fixturePackageRoot(scriptUrl: string): string {
  // backend/scripts/acceptance/<file> → backend/acceptance/fixture-package
  return resolve(dirname(dirname(dirname(new URL(scriptUrl).pathname))), 'acceptance', 'fixture-package');
}
