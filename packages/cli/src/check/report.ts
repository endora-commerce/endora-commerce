/**
 * The report — one line per rule, then the arithmetic
 * (`specs/101-endora-check/contracts/exit-reduction.md` §3).
 *
 * Formatting only. Every decision is made in `run.ts` and every verdict in
 * `hosts.ts`; a reporter that could change either would be a second place the
 * exit code is decided.
 *
 * Two properties are contract rather than presentation:
 *
 *   * **every rule appears**, whatever the aggregate found. That is what makes
 *     the reduction's `max` honest — the information a masked finding is about
 *     is on its own line, not something a reader infers from a scroll;
 *   * **`findings=<n>` is printed even when the exit code is 2** (FR-014). It is
 *     the whole of §4.4's answer to the masking objection, and it is normative.
 */

import { coverageToken, readSizeLine } from '../lib/read-size.js';

import type { LedgerRead } from './ledger.js';
import { reasonFor } from './ledger.js';
import type { RunReport, RuleResult } from './run.js';

const VERDICT_WIDTH = 15;
const ID_WIDTH = 34;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** `ran` splits into the two sub-states a reader cares about. */
function verdictWord(result: RuleResult): string {
  if (result.verdict !== 'ran') return result.verdict;
  return result.findings.length === 0 ? 'clean' : `findings=${result.findings.length}`;
}

function ruleLines(result: RuleResult, ledger: LedgerRead): readonly string[] {
  const lines: string[] = [];
  const head = `  ${pad(result.id, ID_WIDTH)} ${pad(verdictWord(result), VERDICT_WIDTH)}`;
  lines.push(
    result.readSize === null ? `${head}${result.explanation}` : `${head}${readSizeLine(result.readSize)}`,
  );
  if (result.readSize !== null && result.explanation.length > 0) {
    lines.push(`      ${result.explanation}`);
  }
  for (const signal of result.unevaluatedSignals) {
    lines.push(`      not evaluated — ${signal.signal}: ${signal.reason}`);
  }
  for (const finding of result.findings) {
    lines.push(`      ${finding.location ?? result.id}  ${finding.message}`);
  }
  for (const finding of result.acknowledged) {
    lines.push(
      `      acknowledged  ${finding.location ?? result.id}  ${finding.message}`,
    );
    lines.push(`        reason: ${reasonFor(ledger, finding)}`);
  }
  return lines;
}

/**
 * The arithmetic line, last.
 *
 * A narrowed run prints `selected=<n>/<estate>` **in place of** `estate=<n>`, so
 * it cannot be mistaken for a full run's (§6). That is the only difference.
 */
export function arithmeticLine(report: RunReport): string {
  const counts = report.counts;
  const scope =
    report.selected === null
      ? `estate=${counts.estate}`
      : `selected=${report.selected.selected}/${report.selected.estate}`;
  return (
    `endora check: ${scope} ran=${counts.ran} clean=${counts.clean} ` +
    `findings=${counts.findings} not-applicable=${counts.notApplicable} ` +
    `unreadable=${counts.unreadable} pending=${counts.pending}`
  );
}

/** The sentence after the counts — why the run exited as it did. */
export function verdictSentence(report: RunReport): string {
  const counts = report.counts;
  if (report.arithmeticFailures.length > 0) {
    return `  → 2  ${report.arithmeticFailures.join(' ')}`;
  }
  const causes: string[] = [];
  if (counts.pending > 0) {
    const phases = [
      ...new Set(
        report.results
          .filter((result) => result.verdict === 'pending')
          .map((result) => result.explanation),
      ),
    ];
    causes.push(
      `${counts.pending} rule(s) have no package-scope host in this build (${phases.join('; ')})`,
    );
  }
  if (counts.unreadable > 0) {
    causes.push(`${counts.unreadable} rule(s) could not read an input this package must supply`);
  }
  if (causes.length > 0) return `  → 2  ${causes.join('; ')}`;
  if (counts.findings > 0 || report.ledgerFindings.length > 0) {
    return `  → 1  ${counts.findings} rule(s) reported a finding`;
  }
  return '  → 0  the estate was completely evaluated and found nothing';
}

/** The whole report, as the lines the command writes to stdout. */
export function formatReport(report: RunReport, ledger: LedgerRead): readonly string[] {
  const lines: string[] = [
    `endora check: ${report.packageName}@${report.packageVersion}`,
    '',
  ];
  for (const result of report.results) lines.push(...ruleLines(result, ledger));
  if (report.ledgerFindings.length > 0) {
    lines.push('');
    for (const finding of report.ledgerFindings) lines.push(`  ledger: ${finding}`);
  }
  lines.push('', arithmeticLine(report), verdictSentence(report));
  return lines;
}

/** The `sources=` token, re-exported so a caller need not reach past this file. */
export { coverageToken };
