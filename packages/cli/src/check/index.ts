/**
 * `endora check` — the run.
 *
 * One command that evaluates this platform's whole static-check estate against
 * **one module package**, in a checkout that need not be this one
 * (`specs/101-endora-check/`).
 *
 * Every rule in the estate receives exactly one of four verdicts on every run,
 * and this file is where each is decided:
 *
 *   * `repository-only` → `not-applicable`, carrying the declared reason;
 *   * `host: { pending }` → `pending`, naming the phase;
 *   * a host that exists → whatever it answers, over the package's own
 *     declarations.
 *
 * There is no fifth path and no `continue`. A rule that is neither run nor
 * explained is the defect this estate exists against, one layer up, and the
 * arithmetic in `run.ts` is what makes it structurally unreachable — the counts
 * are checked against an estate size this file did not derive from the results
 * it happens to hold.
 */

import { ESTATE, type EstateEntry } from './estate.js';
import { PACKAGE_HOSTS } from './hosts.js';
import { applyLedger, readPackageLedger, type LedgerRead } from './ledger.js';
import { resolvePackageLayout, type PackageLayout } from './layout.js';
import { formatReport } from './report.js';
import { buildRunReport, type RunReport, type RuleResult } from './run.js';

export interface CheckOptions {
  /** The directory to resolve the package from. */
  readonly cwd: string;
  /** `--rule <id>`, repeatable. Empty is a full run. It can only remove. */
  readonly rules?: readonly string[];
  /** `--as-platform`: an acknowledged finding is read as a finding. */
  readonly asPlatform?: boolean;
}

export interface CheckRun {
  readonly report: RunReport;
  readonly ledger: LedgerRead;
  readonly layout: PackageLayout;
  readonly lines: readonly string[];
}

/** A rule the package's own `endora` block cannot make applicable. */
function repositoryOnly(entry: EstateEntry): RuleResult {
  return {
    id: entry.id,
    verdict: 'not-applicable',
    findings: [],
    acknowledged: [],
    readSize: null,
    explanation: `repository-only: ${entry.reason ?? ''}`,
    unevaluatedSignals: entry.partial ?? [],
  };
}

/** A rule with no package-scope host in this build. */
function pendingResult(entry: EstateEntry, phase: string): RuleResult {
  return {
    id: entry.id,
    verdict: 'pending',
    findings: [],
    acknowledged: [],
    readSize: null,
    explanation: `package-scope host lands in ${phase}`,
    unevaluatedSignals: entry.partial ?? [],
  };
}

/** One rule's result, over the layout. Never `undefined`, never a skip. */
export function evaluateRule(entry: EstateEntry, layout: PackageLayout): RuleResult {
  if (entry.scope === 'repository-only') return repositoryOnly(entry);
  if (typeof entry.host === 'object') return pendingResult(entry, entry.host.pending);
  const host = PACKAGE_HOSTS.get(entry.id);
  if (host === undefined) {
    // Refused by `check-inventory.test.ts`'s invariant 4 before it can ship; a
    // run that meets it anyway says so rather than dropping the rule.
    return {
      id: entry.id,
      verdict: 'unreadable',
      findings: [],
      acknowledged: [],
      readSize: null,
      explanation:
        `the estate declares this rule \`host: 'built'\` and this build registers no host ` +
        `for it. That is a defect in the tool, not in the package.`,
      unevaluatedSignals: entry.partial ?? [],
    };
  }
  return host(layout);
}

/**
 * The whole run.
 *
 * The estate is iterated, never filtered by what happens to have a host — which
 * is what makes `estate=<n>` a number the results are *checked against* rather
 * than one derived from them.
 */
export function runCheck(options: CheckOptions, estate: readonly EstateEntry[] = ESTATE): CheckRun {
  const layout = resolvePackageLayout(options.cwd);
  const selectedIds = options.rules ?? [];
  const members = selectedIds.length === 0 ? estate : estate.filter((e) => selectedIds.includes(e.id));

  const evaluated = members.map((entry) => evaluateRule(entry, layout));
  const ledger = readPackageLedger(layout);
  const applied = applyLedger(evaluated, ledger);

  const report = buildRunReport({
    packageName: layout.packageName,
    packageVersion: layout.packageVersion,
    results: applied.results,
    estateSize: estate.length,
    selected:
      selectedIds.length === 0 ? null : { selected: members.length, estate: estate.length },
    ledgerFindings: applied.findings,
    ...(options.asPlatform === undefined ? {} : { asPlatform: options.asPlatform }),
  });

  return { report, ledger, layout, lines: formatReport(report, ledger) };
}

/** Every id `--rule` accepts, for the refusal that names an unknown one. */
export function estateIds(estate: readonly EstateEntry[] = ESTATE): readonly string[] {
  return estate.map((entry) => entry.id);
}

export { ESTATE, ESTATE_SIZE, estateEntry, pendingEntries } from './estate.js';
export {
  NO_PEER_OWNERS,
  readPeerOwners,
  type PeerOwners,
  type UnreadablePeer,
} from './peer-owners.js';
export type {
  EstateEntry,
  EstateHost,
  EstateScope,
  EstateTier,
  PartialSignal,
  SubjectDeclaration,
  SubjectDeclarationKind,
} from './estate.js';
export { PACKAGE_HOSTS, type PackageRuleHost } from './hosts.js';
export {
  applyLedger,
  ledgerKeyOf,
  NO_ACKNOWLEDGED_DEBT,
  readPackageLedger,
  reasonFor,
  type LedgerRead,
  type PackageLedger,
} from './ledger.js';
export {
  isFile,
  layerExpectation,
  NotAModulePackageError,
  resolvePackageLayout,
  type DeclaredLayer,
  type LayerExpectation,
  type PackageLayout,
} from './layout.js';
export { arithmeticLine, formatReport, verdictSentence } from './report.js';
export {
  arithmeticFailures,
  buildRunReport,
  countsOf,
  effectiveFindings,
  reduce,
  type Finding,
  type RunCounts,
  type RunReport,
  type RunReportInput,
  type RuleResult,
  type Selection,
  type Verdict,
} from './run.js';
