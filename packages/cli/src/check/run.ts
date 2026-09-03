/**
 * The verdicts, the arithmetic and the reduction
 * (`specs/101-endora-check/contracts/exit-reduction.md` §1, §3, §4).
 *
 * ## The reduction is `max`, and that is not a new decision
 *
 * `0` and `1` are statements about the **tree**; `2` is a statement about the
 * **run**. So the aggregate's job is to make each code a *complete* statement:
 *
 *   * **2** — the picture is incomplete. There may or may not be findings under
 *     it; repair the picture.
 *   * **1** — the picture is complete and there are findings.
 *   * **0** — the picture is complete and there are none.
 *
 * Every member of this estate already reduces this way internally, over many
 * signals and many files: `check:module-boundary` exits 2 on an owner map that
 * resolved zero tables even when its walk found real unledgered reaches. An
 * aggregate reducing differently would be a second derivation of one convention.
 *
 * The masking objection — *"one unreadable input hides every real finding"* — is
 * answered where it lives: it masks them **in the exit code and nowhere else**.
 * Every rule prints its own line regardless, and {@link countsOf}'s `findings`
 * is printed on the arithmetic line **even when the code is 2**. That is
 * normative (FR-014), not cosmetic.
 *
 * ## The identities have to be able to fail
 *
 * {@link countsOf} takes the estate's size as an argument rather than deriving it
 * from the results it was handed. A count computed by summing the results a run
 * happens to hold can never detect a lost rule — it is a tautology, and the
 * whole point of §3's first identity is that losing a rule is the failure this
 * command exists to make impossible. The second identity fails on a malformed
 * host: a result that is not `ran` and still carries a finding.
 */

import type { ReadSizeInput } from '../lib/read-size.js';

import type { PartialSignal } from './estate.js';

/** One thing a rule found. */
export interface Finding {
  /** The estate id of the rule that found it. */
  readonly rule: string;
  /**
   * The rule's own key shape for this finding — what a package ledger entry
   * names. Never a line number where the rule's repository-side ledger keys on
   * a digest: a line-keyed entry reds on any insertion above the site.
   */
  readonly key: string;
  /** The sentence the author reads. */
  readonly message: string;
  /** Package-relative, or `null` where the finding is about the package. */
  readonly location: string | null;
}

export type Verdict = 'ran' | 'not-applicable' | 'unreadable' | 'pending';

export interface RuleResult {
  /** Matches {@link EstateEntry.id}. */
  readonly id: string;
  readonly verdict: Verdict;
  /** Empty for every verdict but `ran`. */
  readonly findings: readonly Finding[];
  /**
   * Findings a package ledger entry matched. Excluded from the author's exit
   * code, included under `--as-platform` (`contracts/package-ledger.md` §4).
   */
  readonly acknowledged: readonly Finding[];
  /** `null` only for `not-applicable` and `pending`. */
  readonly readSize: ReadSizeInput | null;
  /**
   * Required for every verdict but `ran`, and that requirement **is** the
   * design: a rule that did not run and cannot say why is the silent skip.
   * Making the field non-optional is the cheapest place to make that
   * unreachable.
   */
  readonly explanation: string;
  /** Printed on the rule's own line. */
  readonly unevaluatedSignals: readonly PartialSignal[];
}

export interface RunCounts {
  readonly estate: number;
  readonly ran: number;
  readonly clean: number;
  readonly findings: number;
  readonly notApplicable: number;
  readonly unreadable: number;
  readonly pending: number;
}

/** `null` for a full run; the pair for a `--rule` run. */
export interface Selection {
  readonly selected: number;
  readonly estate: number;
}

export interface RunReport {
  /** As read from the package's own manifest. */
  readonly packageName: string;
  readonly packageVersion: string;
  readonly results: readonly RuleResult[];
  readonly selected: Selection | null;
  readonly counts: RunCounts;
  /**
   * Ledger entries that describe no finding this run produced, that carry no
   * reason, or that are expressed as a count. Each makes the run exit 1; none
   * of them is an estate member, so none disturbs §3's arithmetic.
   */
  readonly ledgerFindings: readonly string[];
  /** Why §3's identities do not hold, or empty. */
  readonly arithmeticFailures: readonly string[];
  /** Computed by {@link reduce} and by nothing else. */
  readonly exitCode: number;
}

/** Which findings count against the exit code, for this reader. */
export function effectiveFindings(result: RuleResult, asPlatform: boolean): readonly Finding[] {
  return asPlatform ? [...result.findings, ...result.acknowledged] : result.findings;
}

/**
 * The counts, over the results and an **independently supplied** estate size.
 *
 * `estateSize` is a parameter rather than `results.length` on purpose — see the
 * header. `clean` and `findings` are each counted directly rather than one being
 * derived from the other, so §3's second identity is a real comparison.
 */
export function countsOf(
  results: readonly RuleResult[],
  estateSize: number,
  asPlatform = false,
): RunCounts {
  const withFindings = results.filter(
    (result) => effectiveFindings(result, asPlatform).length > 0,
  );
  return {
    estate: estateSize,
    ran: results.filter((result) => result.verdict === 'ran').length,
    clean: results.filter(
      (result) =>
        result.verdict === 'ran' && effectiveFindings(result, asPlatform).length === 0,
    ).length,
    findings: withFindings.length,
    notApplicable: results.filter((result) => result.verdict === 'not-applicable').length,
    unreadable: results.filter((result) => result.verdict === 'unreadable').length,
    pending: results.filter((result) => result.verdict === 'pending').length,
  };
}

/**
 * Why §3's identities do not hold, or an empty list.
 *
 * A narrowed run suppresses the first — it is meaningless over a subset — and
 * keeps the second, which is about the results themselves.
 */
export function arithmeticFailures(counts: RunCounts, narrowed: boolean): readonly string[] {
  const failures: string[] = [];
  const verdicts = counts.ran + counts.notApplicable + counts.unreadable + counts.pending;
  if (!narrowed && verdicts !== counts.estate) {
    failures.push(
      `the run reported ${verdicts} verdict(s) over an estate of ${counts.estate}: ` +
        `ran + not-applicable + unreadable + pending != estate. The command has lost a ` +
        `rule, which is the failure this arithmetic exists to make impossible.`,
    );
  }
  if (counts.clean + counts.findings !== counts.ran) {
    failures.push(
      `clean=${counts.clean} + findings=${counts.findings} != ran=${counts.ran}: a rule ` +
        `reported a finding under a verdict that cannot carry one, so the estate's ` +
        `finding count is not a statement about the rules that ran.`,
    );
  }
  return failures;
}

/**
 * The exit code. `max` over the members' own codes, with `pending` folded into 2.
 *
 * ```
 * exit 2  if  unreadable > 0  or  pending > 0  or  either identity fails
 * exit 1  else if  findings > 0  or  a ledger entry is stale
 * exit 0  else
 * ```
 */
export function reduce(
  counts: RunCounts,
  failures: readonly string[],
  ledgerFindings: readonly string[],
): number {
  if (counts.unreadable > 0 || counts.pending > 0 || failures.length > 0) return 2;
  if (counts.findings > 0 || ledgerFindings.length > 0) return 1;
  return 0;
}

export interface RunReportInput {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly results: readonly RuleResult[];
  /** The estate's size — never `results.length` (see the header). */
  readonly estateSize: number;
  /** `null` for a full run. */
  readonly selected: Selection | null;
  readonly ledgerFindings?: readonly string[];
  readonly asPlatform?: boolean;
}

export function buildRunReport(input: RunReportInput): RunReport {
  const asPlatform = input.asPlatform ?? false;
  const ledgerFindings = input.ledgerFindings ?? [];
  const counts = countsOf(input.results, input.estateSize, asPlatform);
  const failures = arithmeticFailures(counts, input.selected !== null);
  return {
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    results: input.results,
    selected: input.selected,
    counts,
    ledgerFindings,
    arithmeticFailures: failures,
    exitCode: reduce(counts, failures, ledgerFindings),
  };
}
