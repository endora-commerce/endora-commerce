/**
 * Where a check's red proof hands its fixture to the check (issue #130).
 *
 * `check-inventory.test.ts` has enforced since issue #113 that every static
 * check goes red on a synthetic fixture. That rule turned out to have a hole,
 * and it was found in the guard itself: the inventory's entry for
 * `check-entry-scope` handed `violationsOf` a **pre-classified record**, so the
 * proof exercised the last function in the chain and never the classifier — and
 * the classifier was what was broken. It grepped for `setInterval(` and could
 * not see a self-rescheduling `setTimeout`, with a live FR-020 gap behind it
 * (issue #128).
 *
 * **A fixture that enters below the defect cannot catch it.** So a proof states
 * where it enters, and anything but the top has to be written down:
 *
 *   - `top` — the fixture is what the check reads in a real run: source text, a
 *     file map, an injected reader, a fixture tree on disk. Every stage the
 *     check owns runs, classifier included.
 *   - `below` — the fixture is a value the check normally *computes*: a parsed
 *     AST, a classified record, a hand-built finding. Everything above the entry
 *     point is unproven, which is exactly where the last two defects sat.
 *
 * The ledger below is two-way, in the idiom of `PORT_CATCHES_TO_DRAIN` and
 * `BARE_SUBSCRIPTIONS_TO_DRAIN`: a proof entering low without an entry fails,
 * and an entry that no longer describes a low proof fails too.
 */

/** Where a red proof hands its fixture to the check it proves. */
export type ProofEntry = 'top' | 'below';

/** One shape a check claims to refuse, and the proof that it still sees it. */
export interface ProvenShape {
  readonly enters: ProofEntry;
  /** Runs the check's analysis over synthetic input; the count it reports. */
  readonly prove: () => number;
}

/** The part of an inventory entry this rule reads. */
export interface ProvenCheck {
  readonly script: string;
  readonly red: Readonly<Record<string, ProvenShape>>;
}

/** `<script>:<shape>` — the ledger key, and the identity of a proof. */
export function proofKey(script: string, shape: string): string {
  return `${script}:${shape}`;
}

/** Every proof that enters below the top of its check's analysis. */
export function lowEntryShapes(checks: readonly ProvenCheck[]): string[] {
  return checks
    .flatMap((check) =>
      Object.entries(check.red)
        .filter(([, proof]) => proof.enters === 'below')
        .map(([shape]) => proofKey(check.script, shape)),
    )
    .sort();
}

export interface LedgerDrift {
  /** Proofs entering low that the ledger does not name. */
  readonly unledgered: readonly string[];
  /** Ledger keys that no longer describe a proof entering low. */
  readonly stale: readonly string[];
}

/**
 * The two-way comparison between the proofs that enter low and the ledger that
 * is supposed to account for them.
 */
export function lowEntryDrift(
  checks: readonly ProvenCheck[],
  ledger: Readonly<Record<string, string>>,
): LedgerDrift {
  const low = lowEntryShapes(checks);
  const known = new Set(low);
  return {
    unledgered: low.filter((key) => ledger[key] === undefined),
    stale: Object.keys(ledger)
      .filter((key) => !known.has(key))
      .sort(),
  };
}
