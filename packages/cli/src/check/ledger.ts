/**
 * The package ledger — acknowledged findings, and who they bind
 * (`specs/101-endora-check/contracts/package-ledger.md`; owner ruling D-196,
 * 2026-09-03).
 *
 * ## Why a package needs one
 *
 * There are findings that are right to stand, and this estate already knows it:
 * the standing example is the KSeF marking on a Polish invoice, an entry in
 * `NON_ENGLISH_DEFAULTS` expected to survive that ledger's drain. A third-party
 * author in a regulated market will have their own. Without a ledger such a
 * module can never reach exit 0 — and a command that cannot be satisfied stops
 * being run, at which point **none** of the estate's rules are enforced rather
 * than most of them.
 *
 * ## Two readers, two answers, and `--as-platform` is a condition of the ruling
 *
 * In this repository a ledger entry is adjudicated in a merge request. A
 * stranger's is not adjudicated by us, so an unqualified package ledger would be
 * a **self-issued exemption from the rules the platform admits modules on,
 * granted by the party being measured** — precisely the shape
 * `check:module-boundary` refuses for a package's own `endora` block.
 *
 *   * the author (`endora check`) reads an acknowledged finding as
 *     *acknowledged*: printed with its reason, contributing nothing to the exit
 *     code;
 *   * the platform (`endora check --as-platform`, and whatever admission gate
 *     consumes it) reads it as **a finding**: exit 1.
 *
 * Both run the same analysis over the same tree and see the same findings. The
 * ledger changes only whether an acknowledged finding contributes to the
 * *author's* exit code. Stating this now costs one flag; retrofitting it once a
 * module ecosystem exists costs a renegotiation with every author in it.
 *
 * ## Never a count
 *
 * Six of this repository's ledgers are per-file count ratchets, and every one
 * exists to freeze debt that **predates its rule**. A new module package
 * predates nothing: a count would let an author write *"3 violations in this
 * file"* on their first commit, licensing debt that has no history, which is the
 * single thing a ratchet must not do. Keyed entries with reasons express a
 * *decision*; counts express a *history*, and a package has none.
 *
 * ## Two-way
 *
 * An entry describing no finding this run produced is itself a finding. That is
 * not optional: it is the property that makes the ledger a ratchet rather than a
 * suppression list. It also means a ledger can never turn exit 2 into exit 0 —
 * an entry naming a rule that did not run describes no finding, so it is stale.
 *
 * ## It is not a `.endorarc`
 *
 * The CLI's constraint forbids **tool configuration**: a file that changes how
 * the program behaves. A ledger changes **what the tree claims about itself**,
 * in the same category as a `command-coverage-ignore` comment or a
 * `naming:allow-snake-case` marker, and it is committed and diffable. There is
 * no way to disable a rule here, only to acknowledge an individual finding.
 */

import { readFileSync } from 'node:fs';

import type { PackageLayout } from './layout.js';
import type { Finding, RuleResult } from './run.js';

/** `<rule id>|<the rule's own key>` → the reason it is right to stand. */
export type PackageLedger = ReadonlyMap<string, string>;

/** The key a ledger entry uses for one finding. */
export function ledgerKeyOf(finding: Finding): string {
  return `${finding.rule}|${finding.key}`;
}

export interface LedgerRead {
  readonly ledger: PackageLedger;
  /** Refusals about the ledger file itself, each exit 1. */
  readonly findings: readonly string[];
  /** Where it was read from, or `null` when the package declares none. */
  readonly path: string | null;
}

/** An empty ledger — the package that declares none. A claim, not a skip. */
export const NO_ACKNOWLEDGED_DEBT: LedgerRead = {
  ledger: new Map(),
  findings: [],
  path: null,
};

/**
 * The ledger the package declares, with the entries it refuses.
 *
 * A ledger that cannot be read is **not** an empty ledger: an unreadable one is
 * reported, because silently treating it as empty would turn every acknowledged
 * finding back into a finding with no explanation of why.
 */
export function readPackageLedger(layout: PackageLayout): LedgerRead {
  if (layout.ledgerPath === null) return NO_ACKNOWLEDGED_DEBT;

  let text: string;
  try {
    text = readFileSync(layout.ledgerPath, 'utf8');
  } catch {
    return {
      ledger: new Map(),
      path: layout.ledgerPath,
      findings: [
        `the \`endora.checkLedger\` declaration names ${layout.keyOf(layout.ledgerPath)}, ` +
          `which could not be read. A declared ledger that is not there is a claim about ` +
          `this package that nothing backs.`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return {
      ledger: new Map(),
      path: layout.ledgerPath,
      findings: [
        `${layout.keyOf(layout.ledgerPath)} does not parse as JSON (${String(error)}).`,
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ledger: new Map(),
      path: layout.ledgerPath,
      findings: [
        `${layout.keyOf(layout.ledgerPath)} is not an object of \`"<rule>|<key>": "<reason>"\` ` +
          `entries. A ledger is keyed and reasoned; there is no other shape it can take.`,
      ],
    };
  }

  const ledger = new Map<string, string>();
  const findings: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number') {
      findings.push(
        `${layout.keyOf(layout.ledgerPath)}: \`${key}\` is a count. Every count ratchet in ` +
          `this estate exists to freeze debt that predates its rule, and a new package ` +
          `predates nothing — a count would license debt with no history. Write the reason ` +
          `the finding is right to stand.`,
      );
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      findings.push(
        `${layout.keyOf(layout.ledgerPath)}: \`${key}\` carries no reason. An entry without ` +
          `one is a suppression, and a suppression is what this ledger is not.`,
      );
      continue;
    }
    ledger.set(key, value);
  }
  return { ledger, findings, path: layout.ledgerPath };
}

export interface LedgerApplication {
  readonly results: readonly RuleResult[];
  /** The ledger's own refusals plus every stale entry. Each makes the run exit 1. */
  readonly findings: readonly string[];
}

/**
 * Split each rule's findings into unacknowledged and acknowledged, and report
 * every entry that matched nothing.
 *
 * The split is the same in both readers; which half counts is
 * {@link effectiveFindings}'s question, not this one's. That is what makes
 * `--as-platform` a second reader of one analysis rather than a strictness dial.
 */
export function applyLedger(
  results: readonly RuleResult[],
  read: LedgerRead,
): LedgerApplication {
  const matched = new Set<string>();
  const applied = results.map((result): RuleResult => {
    const unacknowledged: Finding[] = [];
    const acknowledged: Finding[] = [...result.acknowledged];
    for (const finding of result.findings) {
      const key = ledgerKeyOf(finding);
      if (read.ledger.has(key)) {
        matched.add(key);
        acknowledged.push(finding);
      } else {
        unacknowledged.push(finding);
      }
    }
    return { ...result, findings: unacknowledged, acknowledged };
  });

  const stale = [...read.ledger.keys()]
    .filter((key) => !matched.has(key))
    .map(
      (key) =>
        `stale ledger entry \`${key}\`: this run produced no such finding. An entry ` +
          `describing nothing is what makes the ledger a ratchet rather than a suppression ` +
          `list — delete it, or find out why the rule stopped seeing the site.`,
    );

  return { results: applied, findings: [...read.findings, ...stale] };
}

/** The reason recorded for an acknowledged finding, for the report. */
export function reasonFor(read: LedgerRead, finding: Finding): string {
  return read.ledger.get(ledgerKeyOf(finding)) ?? '';
}
