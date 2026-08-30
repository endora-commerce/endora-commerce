/**
 * The equality harness for feature 090's Phase 3 migration
 * (`specs/090-module-owned-error-codes/`, FR-041 / SC-002).
 *
 * The migration moves the routing answer out of a hard-coded prefix chain and
 * into each owning module's manifest, one merge request per module, and then
 * deletes the chain. Its whole safety property is that the answer does not
 * change: *"for every code in the platform's enumeration, the routing answer
 * after the migration equals the answer the deleted chain gave"*
 * (`contracts/error-code-declaration.md` §6.2), **with no exception list**.
 *
 * This file is the comparison that says so. It exists **before** anything moves,
 * because an assertion written after the fact can only compare a migration to
 * itself: the reference side has to be captured while the function that produces
 * it is still in the tree (§6.3). The frozen capture is
 * `test/fixtures/error-code-routing/chain-answers.ts`; this is the predicate that
 * reads it.
 *
 * **It compares whole maps, in both directions.** A per-code loop over the
 * reference alone answers "did every code the chain routed keep its answer" and
 * is silent about a code the candidate routes and the chain did not — which is
 * exactly the shape a stray declaration in a migrated manifest takes. Both
 * directions are one function so neither can be forgotten.
 */

/** A routing answer, flattened: the code, and the module id it reaches. */
export type RoutingAnswers = Readonly<Record<string, string>>;

/**
 * Why two routing answers differ.
 *
 * - `unrouted`  — the reference routes the code and the candidate does not.
 *                 After the migration this is a module that forgot to declare a
 *                 code it owns, and the operator sees a raw code.
 * - `unexpected` — the candidate routes a code the reference does not. A
 *                 declaration nobody asked for: harmless-looking, and the first
 *                 half of a collision once a second module reaches for it.
 * - `rerouted`  — both route it, to different modules. The sentence moves to
 *                 another bundle, which is the one difference an operator can
 *                 see immediately and the one a reviewer cannot see at all.
 */
export type RoutingDifferenceKind = 'unrouted' | 'unexpected' | 'rerouted';

export interface RoutingDifference {
  readonly code: string;
  readonly kind: RoutingDifferenceKind;
  /** The module the reference routes to, or `null` when it routes nowhere. */
  readonly expected: string | null;
  /** The module the candidate routes to, or `null` when it routes nowhere. */
  readonly actual: string | null;
}

/**
 * Refused rather than reported: a comparison over an empty side is vacuously
 * equal, which is issue #113's shape — a green that means "not looking". Both
 * sides are guarded independently because either can empty while the other is
 * full: the reference is a committed fixture and the candidate is derived from
 * the running tree, and a run that failed to load one of them must not read as
 * agreement.
 */
export class EmptyRoutingComparisonError extends Error {}

export function compareErrorCodeRouting(
  reference: RoutingAnswers,
  candidate: RoutingAnswers,
): RoutingDifference[] {
  if (Object.keys(reference).length === 0) {
    throw new EmptyRoutingComparisonError(
      'the reference routing answer is empty — refusing to report a vacuous equality',
    );
  }
  if (Object.keys(candidate).length === 0) {
    throw new EmptyRoutingComparisonError(
      'the candidate routing answer is empty — refusing to report a vacuous equality',
    );
  }

  const differences: RoutingDifference[] = [];
  for (const code of [...new Set([...Object.keys(reference), ...Object.keys(candidate)])].sort()) {
    const expected = reference[code] ?? null;
    const actual = candidate[code] ?? null;
    if (expected === actual) continue;
    const kind: RoutingDifferenceKind =
      expected === null ? 'unexpected' : actual === null ? 'unrouted' : 'rerouted';
    differences.push({ code, kind, expected, actual });
  }
  return differences;
}

/** One line per difference, in the words a migration reviewer needs. */
export function describeRoutingDifferences(differences: readonly RoutingDifference[]): string {
  return differences
    .map(
      (d) =>
        `  - [${d.kind}] ${d.code}: chain said ${d.expected ?? 'nothing'}, ` +
        `declarations say ${d.actual ?? 'nothing'}`,
    )
    .join('\n');
}

/**
 * Why a module's declaration and the frozen chain capture disagree **about that
 * module**.
 *
 * This is a different question from {@link compareErrorCodeRouting}, and the
 * difference is the one trap feature 090's Phase 3 had that nothing else could
 * see. While the migration was in flight the comparator above measured
 * `composeErrorTranslationTargets` — the declarations laid **over** the prefix
 * chain — so a module that declared ten of the thirteen codes it owned produced
 * a composed map that was still exactly right: the chain answered for the other
 * three and the comparator reported nothing. The migration was half done, the
 * merge request green, and the shortfall would have surfaced on the merge
 * request that deleted the chain, eighteen merge requests later, as three codes
 * that suddenly routed nowhere.
 *
 * Phase 4 has deleted the chain, so the comparator now measures the declarations
 * alone and would catch such a gap directly. This stays because it is the
 * per-module question and the comparator's is the whole-map one: it says *which*
 * module is short and by which codes, which is what a re-routing sweep (D-129,
 * scheduled) needs just as much as the migration did.
 *
 * So completeness is asserted per module, against the capture, on the merge
 * request that migrates it:
 *
 * - `undeclared` — the capture routes the code to this module and the manifest
 *                  does not declare it. The migration is incomplete.
 * - `not-owned`  — the manifest declares a code the capture routes somewhere
 *                  else, or nowhere. `chainAnswer` names where, because the
 *                  useful sentence is "`catalog` owns this", not "you should not
 *                  have it".
 */
export type MigrationGapKind = 'undeclared' | 'not-owned';

export interface MigrationGap {
  readonly code: string;
  readonly kind: MigrationGapKind;
  /** The module the frozen capture routes the code to, or `null` for none. */
  readonly chainAnswer: string | null;
}

/**
 * Refused rather than reported, for the same reason
 * {@link EmptyRoutingComparisonError} is: a module that owns no code in the
 * capture has nothing to be complete about, so "no gaps" would be a green
 * meaning "not looking" — which is what a misspelled roster entry produces.
 */
export class EmptyMigrationScopeError extends Error {}

export function findMigrationGaps(
  moduleId: string,
  declaredCodes: readonly string[],
  chainAnswers: RoutingAnswers,
): MigrationGap[] {
  const owned = Object.keys(chainAnswers).filter((code) => chainAnswers[code] === moduleId);
  if (owned.length === 0) {
    throw new EmptyMigrationScopeError(
      `the frozen chain capture routes no code to "${moduleId}" — refusing to report a ` +
        'vacuous completeness. Either the module id is misspelled, or it is not one of ' +
        'the modules feature 090 Phase 3 migrates.',
    );
  }

  const declared = new Set(declaredCodes);
  const gaps: MigrationGap[] = [];
  for (const code of owned) {
    if (!declared.has(code)) {
      gaps.push({ code, kind: 'undeclared', chainAnswer: moduleId });
    }
  }
  for (const code of declaredCodes) {
    if (chainAnswers[code] === moduleId) continue;
    gaps.push({ code, kind: 'not-owned', chainAnswer: chainAnswers[code] ?? null });
  }
  return gaps.sort((a, b) => a.code.localeCompare(b.code));
}

/** One line per gap, in the words the migrating merge request needs. */
export function describeMigrationGaps(
  moduleId: string,
  gaps: readonly MigrationGap[],
): string {
  return gaps
    .map((gap) =>
      gap.kind === 'undeclared'
        ? `  - [undeclared] ${gap.code}: the chain routes it to ${moduleId} and the ` +
          'manifest does not declare it'
        : `  - [not-owned] ${gap.code}: ${moduleId} declares it and the chain routes it ` +
          `to ${gap.chainAnswer ?? 'nothing'}`,
    )
    .join('\n');
}

/* -------------------------------------------------------------------------- *
 * The minting ledger — a code the frozen capture predates
 * -------------------------------------------------------------------------- */

/**
 * One code minted after the chain was deleted: an owner, and no history.
 *
 * There is deliberately **no `from`**. The chain never answered for it, and a
 * `from` written here would record an answer nobody gave — which is the same
 * objection that keeps the capture frozen.
 */
export interface MintedCode {
  /** The module whose manifest declares it. */
  readonly to: string;
  /** Why the code exists and why it belongs to that module, naming its origin. */
  readonly reason: string;
}

/** The minting ledger: one entry per code the capture predates, keyed by the code. */
export type MintedErrorCodes = Readonly<Record<string, MintedCode>>;

/**
 * The declared addends of the reference side, which the harnesses read together.
 *
 * One today. D-129's remaining sweep adds a second — the re-homing ledger of
 * `specs/090-module-owned-error-codes/d129-sweep.md` §3.3 — and this is the shape
 * it joins.
 */
export interface ReferenceLedgers {
  readonly minted: MintedErrorCodes;
}

/**
 * Refused rather than reported, for the reason
 * {@link EmptyRoutingComparisonError} exists at the comparison below it: every
 * judgement here is made against an **independently derived** reference, and a
 * reference that failed to load answers every question the same way — vacuously
 * for the routing reference, and with a page of invented findings for the ledger
 * faults. Neither is a result (issue #113).
 *
 * The **ledger itself** is deliberately not guarded. A tree in which nothing has
 * been minted since the chain was deleted has an empty one, and that switches
 * nothing off, because `capture ⊕ {}` is the capture — every floor the two
 * harnesses carry bites exactly as it did. The ledger is read **after** the
 * references are checked, so an emptiness of its own can never be what makes a
 * judgement vacuous (issue #215, the shape !1158 met).
 */
export class EmptyLedgerReferenceError extends Error {}

/**
 * The reference side of both harnesses: the frozen capture, plus the codes it
 * predates.
 *
 * `compareErrorCodeRouting` and `findMigrationGaps` are untouched by this — they
 * keep their difference kinds, their gap kinds and their vacuity refusals, and
 * they are simply handed a reference that also knows which codes were minted
 * after the chain was deleted. The comparison still runs over the capture's own
 * key set for everything the chain answered, so FR-041's claim is unweakened; a
 * minted code nobody ledgered is still `unexpected` — *"chain said nothing,
 * declarations say <module>"* — which is the finding, not a defect in it.
 *
 * And `findMigrationGaps` stops throwing `EmptyMigrationScopeError` for a module
 * whose every code is minted, which is exactly the module the capture cannot
 * speak for. The refusal is not weakened: it still fires for a module *nothing*
 * routes to, which is what it is for.
 */
export function intendedRouting(
  capture: RoutingAnswers,
  ledgers: ReferenceLedgers,
): RoutingAnswers {
  if (Object.keys(capture).length === 0) {
    throw new EmptyLedgerReferenceError(
      'the frozen chain capture is empty — refusing to build a routing reference out of ' +
        'it. Every comparison downstream would be vacuous, and a ledger declares the ' +
        'boundary of a population that is not there.',
    );
  }
  const destinations = Object.fromEntries(
    Object.entries(ledgers.minted).map(([code, entry]) => [code, entry.to]),
  );
  return { ...capture, ...destinations };
}

/**
 * Why a ledger entry is not a claim anybody can check.
 *
 * - `captured-code`          — the frozen capture **does** hold the code, so the
 *                              chain answered for it and it was not minted. This
 *                              is the direction that matters most: it is what
 *                              stops a red being cleared by backfilling an answer
 *                              the chain never gave.
 * - `unknown-destination`    — `to` is not a registered module.
 * - `undeclared-destination` — the module named by `to` does not declare the
 *                              code. An entry records the tree as it **is**; this
 *                              refuses a claim written ahead of its manifest
 *                              change, or left behind after one was reverted.
 * - `unreasoned`             — no reason. The diff that mints a code is two lines
 *                              in a manifest and one in an enumeration; the
 *                              reason is the only part of it a reviewer can
 *                              disagree with.
 */
export type LedgerFaultKind =
  | 'captured-code'
  | 'unknown-destination'
  | 'undeclared-destination'
  | 'unreasoned';

export interface LedgerFault {
  readonly code: string;
  readonly kind: LedgerFaultKind;
  /** The owner the entry claims. */
  readonly to: string;
  /**
   * What the independent reference says instead, or `null` where the fault is
   * about the entry alone.
   */
  readonly observed: string | null;
}

/** The independently derived answers a ledger entry is judged against. */
export interface LedgerReferences {
  /** The frozen chain capture, as module ids. Says what the chain answered for. */
  readonly capture: RoutingAnswers;
  /** Code → the modules whose manifests declare it. Says where a code **is**. */
  readonly declaredBy: Readonly<Record<string, readonly string[]>>;
  /** Every registered module id. Says whether a destination exists at all. */
  readonly registeredModuleIds: readonly string[];
}

/**
 * **The ledger, judged against the tree — the entry → world direction.**
 *
 * The other direction is not implemented twice: a code minted and not ledgered is
 * exactly what `compareErrorCodeRouting` reports as `unexpected` once its
 * reference side is {@link intendedRouting}, and what the enumeration-coverage
 * assertion names in the words an author needs. A second implementation of the
 * same question is two answers waiting to disagree. So the two-way property is
 * *"an entry no manifest agrees with fails, and a code no entry accounts for
 * fails"* — this function is the first half, the equality harness is the second,
 * and both run in the same suite.
 *
 * All three references are refused when empty, because each is what a whole class
 * of fault is measured against and an empty one turns that class into invented
 * findings rather than into silence — which is worse, not better.
 */
export function findLedgerFaults(
  ledgers: ReferenceLedgers,
  references: LedgerReferences,
): LedgerFault[] {
  const { capture, declaredBy, registeredModuleIds } = references;
  if (Object.keys(capture).length === 0) {
    throw new EmptyLedgerReferenceError(
      'the frozen chain capture is empty — no entry could be judged against it at all, ' +
        'and `captured-code` would be unreachable for every one of them',
    );
  }
  if (Object.keys(declaredBy).length === 0) {
    throw new EmptyLedgerReferenceError(
      'no module declares any error code — the manifest set failed to resolve, and every ' +
        'entry would be reported as `undeclared-destination`',
    );
  }
  if (registeredModuleIds.length === 0) {
    throw new EmptyLedgerReferenceError(
      'the registered module set is empty — every destination would be reported as ' +
        '`unknown-destination`',
    );
  }

  const registered = new Set(registeredModuleIds);
  const faults: LedgerFault[] = [];
  for (const code of Object.keys(ledgers.minted).sort()) {
    const entry = ledgers.minted[code]!;
    const push = (kind: LedgerFaultKind, observed: string | null = null): void => {
      faults.push({ code, kind, to: entry.to, observed });
    };

    const captured = capture[code] ?? null;
    if (captured !== null) push('captured-code', captured);

    if (!registered.has(entry.to)) {
      push('unknown-destination');
    } else {
      const declarers = declaredBy[code] ?? [];
      if (!declarers.includes(entry.to)) {
        push('undeclared-destination', declarers.length === 0 ? null : declarers.join(', '));
      }
    }

    if (entry.reason.trim() === '') push('unreasoned');
  }
  return faults;
}

/** One line per fault, in the words the merge request that wrote the entry needs. */
export function describeLedgerFaults(faults: readonly LedgerFault[]): string {
  return faults
    .map((fault) => {
      const { code, to, observed } = fault;
      const head = `  - [${fault.kind}] ${code}`;
      switch (fault.kind) {
        case 'captured-code':
          return `${head}: the frozen capture routes it to ${observed ?? 'nothing'}, so the ` +
            'chain answered for it and it was not minted. Do not clear a red by writing an ' +
            'answer the chain never gave.';
        case 'unknown-destination':
          return `${head}: ${to} is not a registered module`;
        case 'undeclared-destination':
          return `${head}: the ledger says ${to} declares it and ` +
            `${observed === null ? 'no module does' : `${observed} does`}. An entry records ` +
            'the tree as it is — write it in the merge request that changes the manifest, ' +
            'not before.';
        case 'unreasoned':
          return `${head}: minted into ${to} with no reason. The diff that mints a code is ` +
            'three lines; the reason is the only part of it a reviewer can disagree with.';
      }
    })
    .join('\n');
}
