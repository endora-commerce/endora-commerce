import type {
  MintedErrorCodes,
  RehomedErrorCodes,
} from '../../helpers/error-code-routing.js';

/**
 * **What the frozen chain capture cannot say.**
 *
 * `chain-answers.ts` records what the deleted prefix chain answered, and it is
 * never edited — *a reference a migration may rewrite is a reference that agrees
 * with whatever the migration did*
 * (`specs/090-module-owned-error-codes/core-block-home.md` §4(d)). Its subject is
 * therefore fixed for good: the codes that existed while the chain existed. This
 * file is where a code that is **outside that subject** is declared, so that the
 * boundary is stated rather than discovered as a red build.
 *
 * Two ledgers, answering different questions about the same reference:
 * {@link MINTED_ERROR_CODES} says *this code did not exist yet*, and
 * {@link REHOMED_ERROR_CODES} says *this code deliberately moved*
 * (D-129's remaining sweep, `d129-sweep.md` §3.3). A code is in one or the other
 * and never both — `findLedgerFaults` reports `double-entry` for one that is.
 *
 * **Neither has any authority over the running platform.** Routing is the
 * manifests' and nothing else's (`contracts/error-code-declaration.md` §4,
 * *"Derivation count: one — the report and the routing come out of the same call,
 * so they cannot disagree"*). These are a reference for a test; giving one
 * authority over composition would be `ERROR_TRANSLATION_KEYS` rebuilt under a
 * new name.
 */

/**
 * **A code that did not exist when the chain was deleted.**
 *
 * The chain is gone and `ERROR_CODES` is not: a module minting a code adds a
 * member to the enumeration, and the capture — which records what the chain
 * *answered* — can never hold it. `PAYMENT_NOT_DUE` has no chain answer to
 * preserve, because there was no chain when it was created.
 *
 * That is **not an exception to FR-041; it is outside FR-041's subject**, and the
 * difference is the whole design here. The equality harness's claim is that the
 * migration preserved every answer *the chain gave*, over the whole of
 * `ERROR_CODES` with no exception list — so the comparison keeps running over the
 * capture's own key set, and the population is stated in two directions instead
 * of being waived:
 *
 * - every member of `ERROR_CODES` is in the capture **or** in this ledger, with
 *   nothing in neither, which is what keeps *"no exception list"* true in
 *   substance — nothing goes unaccounted;
 * - every entry here is **absent from the capture** (`captured-code`), which is
 *   what stops somebody later clearing a red by backfilling an answer the chain
 *   never gave. That direction matters more than the first.
 *
 * Before this ledger existed, a minted code was a permanent red in three places
 * at once — measured on `master` over !1159's three `payments` codes: the
 * enumeration-coverage assertion (`expected […289] to have a length of 292`),
 * three `unexpected` differences *"chain said nothing, declarations say
 * payments"* under a message reading **do not edit the frozen capture**, and the
 * progress harness's roster equality, for which adding the module was not a
 * repair either — `findMigrationGaps` threw `EmptyMigrationScopeError`, the
 * capture routing nothing there. All three are one question, and this is the
 * answer to it.
 *
 * **The shape carries no `from`.** A re-home is a move between two owners; a mint
 * has one owner and no history, and a `from` written here would record an answer
 * nobody gave.
 *
 * **Writing an entry.** Keyed by the code, with:
 *
 * - `to` — the module whose manifest declares it. Checked against the resolved
 *   manifest set, in both directions: an entry the manifests do not agree with is
 *   a fault, and a minted code with no entry is `unexpected` in the equality
 *   harness.
 * - `reason` — why the code exists and why it belongs to that module, naming the
 *   merge request that minted it. A reader three years from now has the capture
 *   for everything the chain answered, and this sentence for everything else.
 *
 * **What this ledger deliberately does not assert** is that its codes are members
 * of `ERROR_CODES`. That claim has an owner already — `check:error-translations`
 * reports a code a module declares and the enumeration does not hold, as
 * `undeclaredInEnum`, which is FR-043's own two-way reconciliation — and a second
 * author of one claim is two answers waiting to disagree.
 */
export const MINTED_ERROR_CODES: MintedErrorCodes = {
  PAYMENT_NOT_DUE: {
    to: 'payments',
    reason:
      'Minted by !1159 so a buyer retrying a payment that is no longer due reads a sentence ' +
      'instead of a generic refusal. The noun is a payment, which `payments` owns (D-121 T1).',
  },
  PAYMENT_ORDER_CLOSED: {
    to: 'payments',
    reason:
      'Minted by !1159 for a retry against an order that has already closed. Same owner and ' +
      'the same tier as the rest of the `PAYMENT_*` family.',
  },
  PAYMENT_ADAPTER_UNAVAILABLE: {
    to: 'payments',
    reason:
      'Minted by !1159 for a retry whose gateway adapter is absent. The noun is the payment ' +
      'adapter, which `payments` owns along with the adapter registry (D-121 T1).',
  },
};

/**
 * **Where D-121 puts a code the frozen chain routed elsewhere** — the re-homing
 * ledger of D-129's remaining sweep (`d129-sweep.md` §3.3, scheduled by D-185.3
 * and settled by D-186 in `specs/080-f4-real-scope/rulings.md`).
 *
 * **What it is for.** The sweep's whole job is to move routing answers; the two
 * harnesses exist to prove routing answers do not move. Spiked on this tree over
 * `ksef`'s seven codes, both refuse it — 7 `rerouted` from the equality harness,
 * 7 `undeclared` plus an `EmptyMigrationScopeError` from the progress harness,
 * because seventeen of the twenty receiving modules are ones the capture routes
 * nothing to. The harnesses are not wrong; they are being asked a question they
 * were built to answer *no* to. This is the answer: a per-code record of every
 * **deliberate** re-home. A move that is here is expected; a move that is not is
 * still `rerouted`, in the same words.
 *
 * **Neither of the two obvious alternatives was available** (§3.2). Re-freezing
 * the capture after each merge request makes all three reds disappear and proves
 * nothing about any of the 79 moves. Deleting the harnesses withdraws the
 * protection from the 210 codes that are outside this sweep entirely.
 *
 * **Why per code and not per module.** 52 of the 79 moves are invisible to every
 * other instrument, being ledgered in `UNTRANSLATED_ERROR_CODES` on both sides of
 * the move: `check:error-translations` sees a ledgered code leave one comment
 * group and join another, and its ratchet is on membership rather than on
 * grouping. For those 52 this ledger is the only thing watching (§3.5).
 *
 * **Why it starts empty, and what that does not switch off.** MR 1 of the sweep
 * is the instrument and moves no code (§5.2), so on the merge request that
 * introduces it there is nothing to record. The plan's own table asks MR 1 for
 * all 79 rows; that is measurably not available, and the measurement is in this
 * ledger's own test — an entry is a claim that the move **has been made**, so 79
 * rows over unmoved manifests is 79 `rerouted` differences and a red tree until
 * the last of them lands. Spiked over `ksef`'s seven on this tree: entries
 * without the manifest change give 7 `rerouted` and 7 `undeclared-destination`;
 * with it, 0 and 0. An entry is therefore written by the merge request that moves
 * its code, which is also the merge request whose reviewer can disagree with the
 * `reason`.
 *
 * An empty ledger is a legal state and it is handled **before** anything is
 * derived from it, never by an exclusion computed over it (issue #215's shape,
 * met once already in !1158): `intendedRouting` refuses an empty **capture** and
 * accepts empty ledgers, so with no entries the reference side is byte-identical
 * to what it was, and every floor the two harnesses carry bites exactly as it
 * did.
 *
 * **Retiring it.** It does not drain. It describes a difference from a frozen
 * capture, so it is as permanent as the capture is: it stops growing when the
 * sweep completes, and the pair is then one artefact saying *here is where every
 * code was, and here is every place one deliberately moved, with why*.
 *
 * **Writing an entry.** One per code, keyed by the code:
 *
 * - `from` — the module the frozen capture routes it to. Not a guess: an entry
 *   whose `from` the capture contradicts is a `wrong-origin` fault.
 * - `to` — the module that declares it after the move. Checked against the
 *   resolved manifest set, so an entry cannot describe a move nobody made.
 * - `tier` — which of D-121's three tiers decided it. T1 the noun, T2 the sole
 *   thrower where the code names a mechanism, T3 platform by declaration.
 * - `reason` — the sentence a reviewer can disagree with. The diff of a move is
 *   two manifest lines; this is the only part of it that carries an argument.
 *   Required by D-121 T3 for the platform block and applied here to T1 and T2 as
 *   well, because it is what makes the sweep reviewable at all.
 *
 * `specs/090-module-owned-error-codes/d129-sweep.md` Appendix A holds the tier and
 * the destination decided for each of the 100 codes; it is the design, and an
 * entry here is the claim that the move is done.
 */
export const REHOMED_ERROR_CODES: RehomedErrorCodes = {
  // ---- Tier A, MR 2 of the sweep: `ksef` (7) and `pim_ergonode` (13). Twenty
  // codes with no sentence in either language anywhere in the tree, so nothing
  // operator-visible moves with them; each was already on
  // `UNTRANSLATED_ERROR_CODES` under `_i18n` and is now on it under its own
  // module's group. Both modules already shipped an i18n bundle, and neither
  // bundle gains a key.
  KSEF_ALREADY_SUBMITTED: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'The noun is a KSeF submission, whose entity (`ksef_submissions`) and whole lifecycle ' +
      'belong to `ksef`; the refusal is of a second filing of an invoice this module has ' +
      'already sent.',
  },
  KSEF_CREDENTIAL_EXISTS: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'The noun is a KSeF credential, which `ksef` owns as `ksef_credentials`, one active ' +
      'row per environment. The uniqueness it refuses is an invariant of that table and of ' +
      'nothing outside this module.',
  },
  KSEF_CREDENTIAL_INVALID: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'Same noun and same owner as `KSEF_CREDENTIAL_EXISTS`: it refuses a certificate or ' +
      'token that cannot be used against the configured KSeF environment.',
  },
  KSEF_ENROLLMENT_REJECTED: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'The noun is a KSeF certificate enrollment, a step of the KSeF protocol that `ksef` ' +
      'performs and that no other module knows about.',
  },
  KSEF_NOT_CONFIGURED: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'It refuses the absence of a KSeF credential for the target environment, which is the ' +
      'same noun as the two above, read rather than written.',
  },
  KSEF_NOT_SUBMITTABLE: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'The noun is the KSeF submission again: it refuses an invoice whose state does not ' +
      'admit filing. The invoice belongs to `invoices`, but the judgement is about whether ' +
      'KSeF will take it, and that belongs to `ksef`.',
  },
  KSEF_UNAVAILABLE: {
    from: '_i18n',
    to: 'ksef',
    tier: 'T1',
    reason:
      'The noun is the KSeF service itself, and this module is the only thing in the ' +
      'platform that talks to it; `KsefUnavailableError` in its client interface is the one ' +
      'thing that produces the code.',
  },
  PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is an Ergonode attribute inside a price binding, and `pim_ergonode` owns ' +
      'both the binding and the notion of an Ergonode attribute; the refusal is about the ' +
      'remote schema, which no other module reads.',
  },
  PIM_ERGONODE_BINDING_EXISTS: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is a price binding, an entity `pim_ergonode` owns outright, and the ' +
      'uniqueness it refuses belongs to that entity.',
  },
  PIM_ERGONODE_CONNECTION_DISABLED: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is the Ergonode connection, this module central entity. It is the enabled ' +
      'flag on that connection and not the module activation control, which answers ' +
      '`MODULE_DISABLED` and stays with the platform.',
  },
  PIM_ERGONODE_CONNECTION_EXISTS: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'Same noun as `PIM_ERGONODE_CONNECTION_DISABLED`: it refuses a second connection row, ' +
      'which is the single-connection invariant `pim_ergonode` holds.',
  },
  PIM_ERGONODE_CURRENCY_INACTIVE: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'A currency is the noun `currencies` owns, but this code names neither a currency nor ' +
      'a currency rule: it refuses an Ergonode price binding onto a currency the shop does ' +
      'not have active, which is a mapping rule of this module and is raised nowhere else. ' +
      'The word in the code is not what decides the owner; the sentence an operator needs ' +
      'here is about the mapping.',
  },
  PIM_ERGONODE_FIELD_PATH_INVALID: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is a protected field path, part of the field-protection model ' +
      '`pim_ergonode` owns; the path is validated against that model and against nothing ' +
      'the catalog owns.',
  },
  PIM_ERGONODE_IMPORT_ALREADY_RUNNING: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is an Ergonode import run, whose entity and single-flight rule both belong ' +
      'to `pim_ergonode`.',
  },
  PIM_ERGONODE_NOT_CONFIGURED: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'It refuses the absence of the Ergonode connection, the same noun as ' +
      '`PIM_ERGONODE_CONNECTION_EXISTS`, read rather than written.',
  },
  PIM_ERGONODE_SCHEDULE_INVALID: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is the import schedule on the connection, a field of an entity ' +
      '`pim_ergonode` owns, with a validity rule of its own.',
  },
  PIM_ERGONODE_TARGET_ALREADY_MAPPED: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is an Ergonode attribute or category mapping, an entity `pim_ergonode` ' +
      'owns; the refusal is its one-target-one-mapping invariant, raised from three places ' +
      'in this module and nowhere else.',
  },
  PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'Same noun as `PIM_ERGONODE_TARGET_ALREADY_MAPPED`: the target of a mapping cannot be ' +
      'resolved. It is about the mapping rather than about the attribute the mapping points ' +
      'at, so it is not `catalog`.',
  },
  PIM_ERGONODE_TREE_REQUIRED: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'The noun is the Ergonode category tree an import has to be told to walk, a concept ' +
      'of the remote PIM that exists only inside this module.',
  },
  PIM_ERGONODE_TYPE_INCOMPATIBLE: {
    from: '_i18n',
    to: 'pim_ergonode',
    tier: 'T1',
    reason:
      'It refuses a mapping between an Ergonode attribute type and a local one that cannot ' +
      'carry it. The judgement belongs to the mapping, which is the noun `pim_ergonode` ' +
      'owns; neither of the two type systems involved is the platform.',
  },
};
