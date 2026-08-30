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
 * The reference ledgers — what the frozen capture cannot say
 * -------------------------------------------------------------------------- */

/**
 * Which of D-121's three tiers decided a code's owner: **T1** the noun, **T2**
 * the sole thrower where the code names a mechanism, **T3** platform by
 * declaration.
 */
export type OwnershipTier = 'T1' | 'T2' | 'T3';

/** One deliberate re-home: where the code was, where it is, and why. */
export interface RehomedCode {
  /** The module the frozen capture routes the code to. */
  readonly from: string;
  /** The module that declares it after the move. */
  readonly to: string;
  /** The D-121 tier that decided it. */
  readonly tier: OwnershipTier;
  /** The sentence a reviewer of the move can disagree with. */
  readonly reason: string;
}

/** The re-homing ledger: one entry per deliberately moved code, keyed by the code. */
export type RehomedErrorCodes = Readonly<Record<string, RehomedCode>>;

const OWNERSHIP_TIERS: ReadonlySet<string> = new Set<OwnershipTier>(['T1', 'T2', 'T3']);

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
 * Two, and they answer different questions about the same reference: *did this
 * code move* (`rehomed`, D-129's sweep) and *did it exist yet* (`minted`).
 */
export interface ReferenceLedgers {
  readonly rehomed: RehomedErrorCodes;
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
 * The **ledgers themselves** are deliberately not guarded. Either may legally be
 * empty — the re-homing one is, until the sweep's first code-moving merge
 * request, and the minting one is on a tree where nothing has been minted since
 * the chain was deleted — and neither switches anything off by being so, because
 * `capture ⊕ {} ⊕ {}` is the capture and every floor the two harnesses carry
 * bites exactly as it did. They are read **after** the references are checked,
 * so an emptiness of their own can never be what makes a judgement vacuous
 * (issue #215, the shape !1158 met).
 */
export class EmptyLedgerReferenceError extends Error {}

/**
 * The reference side of both harnesses: the frozen capture, plus the two things a
 * frozen capture cannot say.
 *
 * `compareErrorCodeRouting` and `findMigrationGaps` are untouched by this — they
 * keep their difference kinds, their gap kinds and their vacuity refusals, and
 * they are simply handed a reference that also knows where a code has
 * deliberately moved and which codes were minted after the chain was deleted.
 * Three consequences are the point:
 *
 * - a move **nobody wrote down** is still `rerouted`, in the same words, because
 *   the reference still says what the chain said;
 * - a re-homing entry whose move **has not been made** is `rerouted` too (the
 *   code is still declared where it was) or `unrouted` (nobody declares it at
 *   all), so an entry cannot be written ahead of its move and sit there green;
 * - a **minted** code nobody ledgered is still `unexpected` — *"chain said
 *   nothing, declarations say <module>"* — which is the finding, not a defect in
 *   it.
 *
 * And `findMigrationGaps` stops throwing `EmptyMigrationScopeError` for a module
 * exactly when a ledger routes it a code: the module whose every code is minted,
 * and the seventeen of D-129's twenty receiving modules the capture routes
 * nothing to. The refusal is not weakened: it still fires for a module *nothing*
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
    [...Object.entries(ledgers.rehomed), ...Object.entries(ledgers.minted)].map(
      ([code, entry]) => [code, entry.to],
    ),
  );
  return { ...capture, ...destinations };
}

/**
 * Why a ledger entry is not a claim anybody can check.
 *
 * Shared by both ledgers:
 *
 * - `unknown-destination`    — `to` is not a registered module.
 * - `undeclared-destination` — the module named by `to` does not declare the
 *                              code. An entry records the tree as it **is**; this
 *                              refuses a claim written ahead of its manifest
 *                              change, or left behind after one was reverted.
 * - `unreasoned`             — no reason. The diff of either change is two or
 *                              three lines; the reason is the only part of it a
 *                              reviewer can disagree with.
 * - `double-entry`           — the code is in both ledgers, which cannot both be
 *                              true: it was either in the block the chain routed
 *                              or it was minted after the chain was deleted.
 *
 * Minting entries only:
 *
 * - `captured-code`          — the frozen capture **does** hold the code, so the
 *                              chain answered for it and it was not minted. This
 *                              is the direction that matters most: it is what
 *                              stops a red being cleared by backfilling an answer
 *                              the chain never gave. If the code is moving, it is
 *                              a re-home.
 *
 * Re-homing entries only:
 *
 * - `unknown-code`           — the frozen capture does not hold the code, so this
 *                              is not a move out of the block. A code minted
 *                              after the chain was deleted belongs in the minting
 *                              ledger.
 * - `wrong-origin`           — `from` is not where the capture had it.
 * - `not-a-move`             — `from` and `to` are the same module.
 * - `unknown-tier`           — `tier` is not one of D-121's three.
 */
export type LedgerFaultKind =
  | 'unknown-destination'
  | 'undeclared-destination'
  | 'unreasoned'
  | 'double-entry'
  | 'captured-code'
  | 'unknown-code'
  | 'wrong-origin'
  | 'not-a-move'
  | 'unknown-tier';

/** Which ledger the entry is in. */
export type LedgerName = 'rehomed' | 'minted';

export interface LedgerFault {
  readonly code: string;
  readonly ledger: LedgerName;
  readonly kind: LedgerFaultKind;
  /** The origin the entry claims, or `null` for a minted code, which has none. */
  readonly from: string | null;
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
 * **The ledgers, judged against the tree — the entry → world direction.**
 *
 * The other direction is not implemented twice: a move the manifests made and no
 * ledger holds is exactly what `compareErrorCodeRouting` reports as `rerouted`
 * once its reference side is {@link intendedRouting}, a code minted and not
 * ledgered is what it reports as `unexpected`, and the enumeration-coverage
 * assertion names the second in the words an author needs. A second
 * implementation of the same question is two answers waiting to disagree. So the
 * two-way property is *"an entry no manifest agrees with fails, and a change no
 * entry accounts for fails"* — this function is the first half, the equality
 * harness is the second, and both run in the same suite.
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
      'the frozen chain capture is empty — every re-homing entry would be reported as ' +
        '`unknown-code` and `captured-code` would be unreachable for every minting entry, ' +
        'which is a page of invented findings rather than a measurement',
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

  const judgeShared = (
    code: string,
    ledger: LedgerName,
    from: string | null,
    to: string,
    reason: string,
  ): void => {
    const push = (kind: LedgerFaultKind, observed: string | null = null): void => {
      faults.push({ code, ledger, kind, from, to, observed });
    };
    if (!registered.has(to)) {
      push('unknown-destination');
    } else {
      const declarers = declaredBy[code] ?? [];
      if (!declarers.includes(to)) {
        push('undeclared-destination', declarers.length === 0 ? null : declarers.join(', '));
      }
    }
    if (reason.trim() === '') push('unreasoned');
  };

  for (const code of Object.keys(ledgers.rehomed).sort()) {
    const entry = ledgers.rehomed[code]!;
    const push = (kind: LedgerFaultKind, observed: string | null = null): void => {
      faults.push({ code, ledger: 'rehomed', kind, from: entry.from, to: entry.to, observed });
    };
    if (code in ledgers.minted) push('double-entry');

    const captured = capture[code] ?? null;
    if (captured === null) push('unknown-code');
    else if (captured !== entry.from) push('wrong-origin', captured);

    if (entry.from === entry.to) push('not-a-move');
    if (!OWNERSHIP_TIERS.has(entry.tier)) push('unknown-tier');

    judgeShared(code, 'rehomed', entry.from, entry.to, entry.reason);
  }

  for (const code of Object.keys(ledgers.minted).sort()) {
    const entry = ledgers.minted[code]!;
    // `double-entry` is reported once, under the re-homing ledger, so a code in
    // both produces one fault rather than a pair a reader has to reconcile.
    const captured = capture[code] ?? null;
    if (captured !== null && !(code in ledgers.rehomed)) {
      faults.push({
        code,
        ledger: 'minted',
        kind: 'captured-code',
        from: null,
        to: entry.to,
        observed: captured,
      });
    }
    judgeShared(code, 'minted', null, entry.to, entry.reason);
  }

  return faults;
}

/** One line per fault, in the words the merge request that wrote the entry needs. */
export function describeLedgerFaults(faults: readonly LedgerFault[]): string {
  return faults
    .map((fault) => {
      const { code, from, to, observed } = fault;
      const claim = from === null ? `minted into ${to}` : `${from} -> ${to}`;
      const head = `  - [${fault.kind}] ${code} (${fault.ledger})`;
      switch (fault.kind) {
        case 'unknown-destination':
          return `${head}: ${to} is not a registered module`;
        case 'undeclared-destination':
          return `${head}: the ledger claims ${claim} and ` +
            `${observed === null ? 'no module declares it' : `${observed} declares it`}. An ` +
            'entry records the tree as it is — write it in the merge request that changes ' +
            'the manifest, not before.';
        case 'unreasoned':
          return `${head}: ${claim} with no reason. The diff of the change is two or three ` +
            'lines; the reason is the only part of it a reviewer can disagree with.';
        case 'double-entry':
          return `${head}: the code is in both ledgers. It was either in the block the ` +
            'chain routed, or it was minted after the chain was deleted — never both.';
        case 'captured-code':
          return `${head}: the frozen capture routes it to ${observed ?? 'nothing'}, so the ` +
            'chain answered for it and it was not minted. If it is moving, it is a re-home; ' +
            'do not clear a red by writing an answer the chain never gave.';
        case 'unknown-code':
          return `${head}: the ledger claims ${claim} and the frozen capture does not hold ` +
            'the code at all. A code minted after the chain was deleted belongs in ' +
            'MINTED_ERROR_CODES.';
        case 'wrong-origin':
          return `${head}: the ledger says it came from ${from ?? 'nothing'} and the frozen ` +
            `capture routes it to ${observed ?? 'nothing'}`;
        case 'not-a-move':
          return `${head}: ${from ?? 'nothing'} to itself is not a re-home`;
        case 'unknown-tier':
          return `${head}: the tier is not one of D-121's three (T1 the noun, T2 the sole ` +
            'thrower, T3 platform by declaration)';
      }
    })
    .join('\n');
}
