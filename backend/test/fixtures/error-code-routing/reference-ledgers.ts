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
  // ---- Tier A, MR 3 of the sweep: the rest of the sentence-free block —
  // `prompt_actions` (6), `custom_fields` (5), `customers` (2),
  // `shopping_lists` (2), `price_lists` (1), `transactional_emails` (1).
  // Seventeen codes with no sentence in either language anywhere in the tree,
  // so nothing operator-visible moves with them; each was on
  // `UNTRANSLATED_ERROR_CODES` under `_i18n`. Fifteen are on it under their own
  // module's group now; the two `SHOPPING_LIST_*` codes leave the ledger
  // instead, because that module had to create a bundle anyway and §5.4's
  // recommended answer — write the sentence rather than ship `{}` — was taken.
  ASSISTANT_DISABLED: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'The noun is the prompt assistant, the LLM capability `prompt_actions` configures, ' +
      'gates and calls. It is not the module switch: this refuses a submission while the ' +
      'module is present and on and its own `assistant_enabled` kill switch is off, which is ' +
      'a state only this module has.',
  },
  ASSISTANT_NOT_CONFIGURED: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'Same noun and same owner as `ASSISTANT_DISABLED`, one condition along: the assistant ' +
      'is enabled but its provider, model or API key is missing. Both are decided in this ' +
      "module's `LlmProviderFactory` and nowhere else.",
  },
  PROMPT_PERMISSION_REVOKED: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'The noun is a prompt action plan whose step lost the permission it was planned under. ' +
      'The permission belongs to whichever module the step targets, but the refusal is about ' +
      'the plan — a `PromptActionRequest` this module owns — being abandoned mid-execution, ' +
      'which is why it is not `FORBIDDEN`.',
  },
  PROMPT_PLAN_EXPIRED: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'The noun is the plan again, and the expiry is this module\'s own lazy deadline on it: ' +
      'no sweeper, checked exactly at confirm. Nothing outside `prompt_actions` knows a plan ' +
      'has a lifetime.',
  },
  PROMPT_REQUEST_INVALID_STATE: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'The noun is the prompt action request and the refusal is its state machine — clarify, ' +
      'confirm and cancel each admit one status and answer this for the rest. The machine is ' +
      "this module's entity and this module's alone, which is what makes it not " +
      '`INVALID_TRANSITION` (the platform code D-122 keeps for a contested noun).',
  },
  PROMPT_REQUEST_IN_FLIGHT: {
    from: '_i18n',
    to: 'prompt_actions',
    tier: 'T1',
    reason:
      'Same noun: one in-flight request per operator, counted over this module\'s own rows. ' +
      'It is a 429 and is still not `RATE_LIMITED` — that code is a platform declaration ' +
      '(`GENERIC_ERROR_CODES`) about request volume, this one is a concurrency invariant of ' +
      'one entity.',
  },
  CUSTOM_FIELD_DEFINITION_INVALID: {
    from: '_i18n',
    to: 'custom_fields',
    tier: 'T1',
    reason:
      'The noun is a custom-field definition, an entity `custom_fields` owns outright. It ' +
      'refuses a definition change the registry does not admit — a locked value type, an ' +
      'option still in use — and every one of those rules lives in this module.',
  },
  CUSTOM_FIELD_HOST_MANAGED: {
    from: '_i18n',
    to: 'custom_fields',
    tier: 'T1',
    reason:
      'The noun is the definition again, and the refusal is entity-agnostic by construction: ' +
      'the generic route checks only that the entity type carries a `managedBy` marker, never ' +
      'which module it names. So it is a rule of this registry and not of the host module the ' +
      'message happens to mention.',
  },
  CUSTOM_FIELD_KEY_CONFLICT: {
    from: '_i18n',
    to: 'custom_fields',
    tier: 'T1',
    reason:
      'The noun is a custom-field key, and its uniqueness within an entity type is an ' +
      "invariant of this module's own table.",
  },
  CUSTOM_FIELD_NOT_FOUND: {
    from: '_i18n',
    to: 'custom_fields',
    tier: 'T1',
    reason:
      'The absence of a definition this module owns, raised from its own admin routes.',
  },
  CUSTOM_FIELD_VALUE_INVALID: {
    from: '_i18n',
    to: 'custom_fields',
    tier: 'T1',
    reason:
      'The word in the code is not what decides the owner, and here they happen to agree ' +
      'while the raise sites do not. Five modules raise it — `catalog`, `customers`, ' +
      '`orders`, `organizations`, `quote_requests` — and not one decides it: each hands its ' +
      "host row's values to this module's validation seam and re-answers the failures it gets " +
      'back. The judgement, the rules and the definitions the rules come from are all here ' +
      '(D-121 T1; `d129-sweep.md` §2.3 flags it by name).',
  },
  CUSTOMER_ADDRESS_NOT_FOUND: {
    from: '_i18n',
    to: 'customers',
    tier: 'T1',
    reason:
      'The prefix is `CUSTOMER_` and the noun is not the customer: it is a `CustomerAddress`, ' +
      'whose entity this module owns. D-186 §1 settles the split — `customer_accounts` owns ' +
      'the customer record, `customers` owns the address — so the four `CUSTOMER_*` record ' +
      'codes go elsewhere and this one comes here, on the same rule that separates them.',
  },
  REGISTRATION_REQUIRES_ORGANIZATION: {
    from: '_i18n',
    to: 'customers',
    tier: 'T2',
    reason:
      'T1 does not decide it: the code names a registration and an Organization, and ' +
      '`organizations` owns the second noun. T2 does. The code names a mechanism — the ' +
      "storefront's standalone self-registration path — which this module implements in " +
      '`customer-registration-service.ts` and is the only thing in the tree that raises. What ' +
      "it refuses is this module's own setting being off, not a judgement `organizations` " +
      'makes.',
  },
  SHOPPING_LIST_CANNOT_DELETE_DEFAULT: {
    from: '_i18n',
    to: 'shopping_lists',
    tier: 'T1',
    reason:
      "The noun is a shopping list, this module's own entity, and the refusal is an invariant " +
      "of it: the default list is the customer's permanent anchor, so it can be emptied but " +
      'never deleted. It arrives with a sentence in both languages rather than a ledger entry ' +
      "— §5.4's recommended answer for a module that has to create a bundle anyway.",
  },
  SHOPPING_LIST_CANNOT_DELETE_LAST: {
    from: '_i18n',
    to: 'shopping_lists',
    tier: 'T1',
    reason:
      'Same noun and same owner: an account always keeps at least one list. Also written ' +
      'rather than ledgered.',
  },
  PRICE_LIST_NOT_FOUND: {
    from: '_i18n',
    to: 'price_lists',
    tier: 'T1',
    reason:
      "The noun is a price list, which `price_lists` owns; `pim_ergonode` raises it from its " +
      'mapping service after this module\'s read port answers 404, which makes it the caller ' +
      'and not the owner. The cleanest disagreement in the sweep between D-121 and the ' +
      'sole-raiser count (`d129-sweep.md` §2.2), and the reason MR 2 left it behind while ' +
      "moving thirteen of `pim_ergonode`'s own codes.",
  },
  TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE: {
    from: '_i18n',
    to: 'transactional_emails',
    tier: 'T1',
    reason:
      'The word `NOT_DEACTIVATABLE` reads like the module lifecycle and is not: the noun is ' +
      'one transactional email that the registry marks always-on, not a module an operator ' +
      "may not switch off — that is the platform's `MODULE_NOT_DEACTIVATABLE`, which stays. " +
      'The per-email control exists precisely because this module\'s own activation is ' +
      "`nonDeactivatable` (issue #89), and the registry it is read from is this module's.",
  },
  // ---- Tier B, MR 4 of the sweep: twenty codes into the six receivers that
  // already ship an i18n bundle — `catalog` (6), `customer_accounts` (7),
  // `orders` (3), `mfa` (2), `newsletter` (1), `promotions` (1). This is the
  // first batch that **deletes** from `_i18n`'s bundle: eight of the twenty
  // carried a placeholder there, the code rewritten twice, which D-186 §2
  // refuses to carry into a module's own bundle. Four were rewritten as prose
  // in the receiver's bundle (`d129-sweep.md` §5.4, which keeps that option
  // open and is not a re-opening of the ruling) and four were deleted and
  // ledgered in `UNTRANSLATED_ERROR_CODES`, every one of those four being a
  // code nothing in the tree raises.
  BULK_TOO_LARGE: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T2',
    reason:
      'T1 does not decide it: "bulk" names no entity, so there is no noun to own. T2 does. ' +
      'The code names a mechanism — the 200-product ceiling on ' +
      '`POST /admin/catalog/products/bulk-update` — which `catalog` implements in ' +
      '`catalog-bulk-update.service.ts` and is the only thing in the tree that raises. Its ' +
      '`details` carry `{ maxBatchSize, recommendedSplitInto }` and no `code`, so the ' +
      'sentence it still owes belongs at the base key.',
  },
  PACKAGING_UNIT_NAME_CONFLICT: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T1',
    reason:
      'The noun is a packaging unit, a row on a Product that `catalog` owns outright, and ' +
      'the uniqueness it refuses — one name per product — is an invariant of that table.',
  },
  PACKAGING_UNIT_NOT_FOUND: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T1',
    reason:
      'Same noun and same owner, and this is the one of the three where the raise sites ' +
      'disagree with the answer: `carts` raises it too, from `cart-service.ts`, resolving ' +
      "the unit a line is being added in before it can price it. That is the caller reading " +
      "`catalog`'s row and renaming its absence, which D-95.2 already ruled is not " +
      'ownership.',
  },
  PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T1',
    reason:
      'The noun is the packaging unit again, and the rule it refuses is about the product ' +
      "type it would hang from — virtual, bundle and grouped products take none. Both " +
      'halves of that judgement are `catalog`\'s.',
  },
  SELECTION_TOO_LARGE: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T2',
    reason:
      '`BULK_TOO_LARGE`\'s twin one tier down the same reasoning: "selection" is nobody\'s ' +
      'entity, and the mechanism is the 10 000-match ceiling on ' +
      '`POST /admin/catalog/products/resolve-ids`, implemented and raised only in ' +
      "`catalog-admin.service.ts`. Kept with its sibling for the same reason a family is " +
      'kept whole: an operator meeting one of the two ceilings should not find the other ' +
      'answered by a different module.',
  },
  SYSTEM_ATTRIBUTE_SET_IMMUTABLE: {
    from: '_i18n',
    to: 'catalog',
    tier: 'T1',
    reason:
      "The noun is an Attribute Set, this module's own entity, and the refusal is the " +
      'system set\'s two invariants — its `code` is a stable integration key and cannot be ' +
      'changed, and the set itself cannot be deleted. It is the one code in this batch\'s ' +
      '`catalog` six that carried a placeholder (`"System Attribute Set Immutable."`), and ' +
      'it arrives with real prose in both languages instead: the meaning is plain at both ' +
      'raise sites and the reader is an operator on the Attribute Sets screen, so §5.4\'s ' +
      'available option was taken and the code leaves the untranslated ledger rather than ' +
      'joining it under a new owner.',
  },
  ACCOUNT_BLOCKED: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'The noun is the account, and the refusal is a `CustomerAccount` status column this ' +
      "module owns, checked in its own `customer-auth-service.ts` at sign-in. Nothing " +
      'outside the module knows an account can be blocked.',
  },
  CANNOT_DEMOTE_LAST_ADMIN: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'It reads like `organizations` and is not: the invariant is counted over ' +
      '`CustomerAccount.role` within one organization, in this module\'s `role-service.ts`, ' +
      'which is the only thing in the tree that raises it. `organizations` owns the ' +
      'organization; this module owns its membership. It carried a placeholder and arrives ' +
      'with prose instead (§5.4): the reader is an organization administrator managing ' +
      'their own company\'s users and the refusal has one remedy to offer.',
  },
  CANNOT_REMOVE_LAST_ADMIN: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'Same noun, same service and the same invariant read as a removal rather than a ' +
      'demotion. Also written rather than ledgered.',
  },
  CUSTOMER_ALREADY_DELETED: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'D-186 §1 settles the noun: `customer_accounts` owns the customer **record** and ' +
      '`customers` owns `CustomerAddress`. This is the record\'s soft-delete state. It is ' +
      'also one of the two codes in this batch that the *other* module raises — ' +
      '`customers`\' `customer-deletion-service.ts` throws it, and so does this module\'s ' +
      '`customer-account-lifecycle-ports.ts` — which is D-95.2\'s shape and is accepted in ' +
      'terms by the ruling: the owner of a noun is not required to be the module that ' +
      'throws about it.',
  },
  CUSTOMER_NOT_DELETED: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'The same record state read the other way round, raised only here, from ' +
      '`customer-account-lifecycle-ports.ts`: a restore refused because there is nothing ' +
      'to restore.',
  },
  CUSTOMER_NOT_FOUND: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'The second of the two codes the sibling module raises more often than the owner ' +
      'does: four of the six raise sites are in `customers` (`routes.self.ts`, ' +
      '`customer-deletion-service.ts`, `customer-moderation-service.ts`, ' +
      '`customer-org-assignment-service.ts`) and two are here. In every one of the four, ' +
      '`customers` is resolving a `CustomerAccount` before doing its own work — the caller ' +
      'reporting the absence of the owner\'s row. D-186 §1 puts the record here and ' +
      'accepts that consequence deliberately.',
  },
  CUSTOMER_RESTORE_WINDOW_ELAPSED: {
    from: '_i18n',
    to: 'customer_accounts',
    tier: 'T1',
    reason:
      'The noun is the record again and the window is a property of it: after the retention ' +
      'period the row is anonymized and there is nothing left to restore. Raised only in ' +
      'this module\'s `customer-account-lifecycle-ports.ts`.',
  },
  CURRENCY_MISMATCH: {
    from: '_i18n',
    to: 'orders',
    tier: 'T2',
    reason:
      'T1 does not decide it and the sweep marks it a judgement: the noun is a currency, ' +
      'which `currencies` owns, and the condition is detected by `credit_limits`. But ' +
      '`credit_limits` does not raise it — its reserve port returns ' +
      "`{ ok: false, code: 'CURRENCY_MISMATCH' }` as a typed result, a `readonly code` " +
      'claim rather than a throw — and `orders` is what turns that into a 422 inside the ' +
      'placement transaction, so that a refusal rolls the Order row back. The mechanism the ' +
      'code names is the currency agreement between an order and the credit limit paying ' +
      'for it, and that agreement exists nowhere else. It carried a placeholder and arrives ' +
      'with prose (§5.4): the reader is a buyer stopped at checkout with one remedy to ' +
      'offer.',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    from: '_i18n',
    to: 'orders',
    tier: 'T2',
    reason:
      'T1 does not decide it: an idempotency key is nobody\'s entity. T2 does. The code ' +
      'names a mechanism — the `Idempotency-Key` header contract on the external order ' +
      'intake — which `orders` implements in `order-api-intake-service.ts` and alone ' +
      'raises. Its reader is a machine posting orders over the API, which is why it stays ' +
      'an `UNTRANSLATED_ERROR_CODES` entry rather than gaining a sentence with the move.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    from: '_i18n',
    to: 'orders',
    tier: 'T2',
    reason:
      'Same mechanism and same service, one step further in: the key was seen before with a ' +
      'different payload hash, which is the intake\'s own stored state. Kept with its ' +
      'sibling.',
  },
  TWO_FACTOR_REQUIRED: {
    from: '_i18n',
    to: 'mfa',
    tier: 'T1',
    reason:
      "The noun is the second factor, which is this module's entire subject; it reached the " +
      'platform block only because it does not carry the `MFA_` prefix the deleted chain ' +
      'keyed on, and `mfa`\'s own manifest has recorded it as the code a reader would look ' +
      'for there and not find since Phase 3. **Nothing in the tree raises it**, so its ' +
      'placeholder is deleted and not rewritten: with no raise site, a sentence could only ' +
      'be invented from the code\'s name, which is the placeholder again in longer words. ' +
      'It joins `UNTRANSLATED_ERROR_CODES` under `mfa`.',
  },
  TWO_FACTOR_REQUIRED_BY_ROLE: {
    from: '_i18n',
    to: 'mfa',
    tier: 'T1',
    reason:
      'Same subject, and `_BY_ROLE` names `MfaOrganizationPolicy` — the per-role enforcement ' +
      'this module owns outright. Also unraised, also deleted rather than rewritten, also ' +
      'ledgered under `mfa`.',
  },
  ALREADY_SUBSCRIBED: {
    from: '_i18n',
    to: 'newsletter',
    tier: 'T1',
    reason:
      'The noun is a subscription, and `NewsletterSubscriber` with its double opt-in — which ' +
      'is what decides when a second sign-up is a duplicate rather than a re-confirmation — ' +
      'is this module\'s entity. The sweep calls the attribution weak and it is: nothing ' +
      'raises the code, and the one competing claim in the tree is a doc comment in ' +
      "`inventory`'s `availability-notification-service.ts` promising a 409 for a duplicate " +
      'restock subscribe, which that method does not issue — it returns the existing row. So ' +
      'the competing claim is a refusal nobody implemented. Unraised, so the placeholder is ' +
      'deleted rather than rewritten and the code joins `UNTRANSLATED_ERROR_CODES` under ' +
      '`newsletter`.',
  },
  PROMOTION_INVALID: {
    from: '_i18n',
    to: 'promotions',
    tier: 'T1',
    reason:
      'The noun is a promotion, which this module owns along with its rules and its Rule ' +
      'Builder. Nothing raises it: `carts` answers every coupon refusal it makes with ' +
      '`CART_COUPON_REJECTED` and a `details.code` from `couponDropReasonSchema`, and its ' +
      'manifest already records this code as one that reads like the coupon path and is not ' +
      'part of it. Unraised, so the placeholder is deleted rather than rewritten and the ' +
      'code joins `UNTRANSLATED_ERROR_CODES` under `promotions`.',
  },
  // ---- Tier B, MR 5 of the sweep: the four receivers that had to **create** an
  // i18n bundle — `credit_limits` (5), `api_keys` (3), `addresses` (2) and
  // `webhooks` (1). Nine of the eleven carried a placeholder in `_i18n`'s
  // bundle; D-186 §2 deletes those rather than carrying them, and §5.4 keeps
  // writing the prose available. Six were written and three were not, and every
  // one of the three says below which of the two grounds put it there: no raise
  // site at all, or a raise whose reader is a program and whose message names
  // something a fixed sentence would take away.
  ACTIVE_RESERVATIONS_EXIST: {
    from: '_i18n',
    to: 'credit_limits',
    tier: 'T1',
    reason:
      'The noun is a reservation against a credit limit, and `credit_limit_reservations` is ' +
      "this module's own table — the only `*Reservation` entity in the tree. The sweep calls " +
      'the attribution weak because nothing raises the code; that is also why the placeholder ' +
      'is deleted rather than rewritten and the code joins `UNTRANSLATED_ERROR_CODES` under ' +
      '`credit_limits`. With no raise site there is no refusal to describe.',
  },
  ADJUSTMENT_BELOW_ACTIVE: {
    from: '_i18n',
    to: 'credit_limits',
    tier: 'T1',
    reason:
      'The noun is the credit-limit adjustment, and both halves of the refusal — the granted ' +
      'amount and the sum of active reservations — are this module\'s rows. Its one raise is ' +
      "in this module's own routes. It carried a placeholder and arrives with prose (§5.4): " +
      'the reader is an operator lowering a limit on the Credit Limits screen, and the raise ' +
      'site states the refusal in full.',
  },
  CREDIT_LIMIT_ALREADY_GRANTED: {
    from: '_i18n',
    to: 'credit_limits',
    tier: 'T1',
    reason:
      'The noun is the credit limit itself, and the uniqueness it refuses — one limit per ' +
      "organization — is an invariant of this module's table. Raised only here. Placeholder " +
      'deleted, prose written: the reader is the operator who just pressed Grant, and the ' +
      'remedy is to adjust the existing limit instead.',
  },
  CREDIT_LIMIT_NOT_GRANTED: {
    from: '_i18n',
    to: 'credit_limits',
    tier: 'T1',
    reason:
      'Same noun, read rather than written. Six raise sites, five of them in this module and ' +
      'one in `orders`, which asks this module for the organization\'s limit before deciding ' +
      'whether a deferred-payment order can be placed — the caller reporting the absence of ' +
      "the owner's row, D-95.2's shape. Placeholder deleted, prose written: the sentence is " +
      'true of both readers, because the refusal is the same fact in each.',
  },
  LIMIT_INSUFFICIENT: {
    from: '_i18n',
    to: 'credit_limits',
    tier: 'T1',
    reason:
      'The noun is the credit limit, and the family it belongs with — `CREDIT_LIMIT_*`, ' +
      '`ADJUSTMENT_BELOW_ACTIVE`, `ACTIVE_RESERVATIONS_EXIST` — is this module\'s. `orders` ' +
      'is its only raiser because this module\'s reserve seam *returns* ' +
      "`{ ok: false, code: 'LIMIT_INSUFFICIENT' }` as a typed result rather than throwing: a " +
      '`readonly code` claim is not a raise. Placeholder deleted, prose written: the reader ' +
      'is a buyer stopped at checkout, and the two amounts the raise interpolates are already ' +
      'on the page — the checkout renders the available credit beside the order total.',
  },
  API_KEY_CHANNEL_MISMATCH: {
    from: '_i18n',
    to: 'api_keys',
    tier: 'T1',
    reason:
      'The noun is the API key and its distributor binding, both columns of this module\'s ' +
      'row, and homing it here keeps the `API_KEY_*` family in one bundle. It is the sweep\'s ' +
      'one code raised by the **platform** — the sales-channel resolver middleware — which ' +
      'D-186 §3 settles in favour of T1 as written, because the alternative is the thrower ' +
      'rule D-121 rejected by measurement. The coupling it creates is real and is the ' +
      'condition of the ruling: this merge request asserts the raise is unreachable while ' +
      '`api_keys` is absent, in ' +
      '`test/integration/_lifecycle/non-binding-degradation.integration.test.ts`. It had no ' +
      'sentence before the move and has none after; it stays on ' +
      '`UNTRANSLATED_ERROR_CODES`, under `api_keys`.',
  },
  API_KEY_NOT_BOUND: {
    from: '_i18n',
    to: 'api_keys',
    tier: 'T1',
    reason:
      'The noun is the API key\'s distributor binding. Three modules raise it — this one, ' +
      '`catalog` and `orders` — each gating its own external namespace with the identical ' +
      'sentence, which is what makes T2 inapplicable and T1 decisive: they are all asking ' +
      'the same question about somebody else\'s row. No sentence before the move and none ' +
      'after.',
  },
  API_KEY_OUT_OF_SCOPE: {
    from: '_i18n',
    to: 'api_keys',
    tier: 'T1',
    reason:
      'The noun is the API key\'s scope set, a column on this module\'s row, and this module ' +
      'raises it from its own authentication gate. It is the first code in the sweep ' +
      'ledgered **despite** a live raise site, on two grounds: its reader is an integration ' +
      'rather than a person, and the raise names the scope the key is missing — ' +
      '`API key lacks the required scope: <scope>.` — which a fixed sentence would replace ' +
      'with a vaguer one, because the envelope substitutes the message wholesale and this ' +
      'raise passes no `details` for a placeholder to be filled from. Writing the sentence ' +
      'would take information away from the only audience that meets it, so the placeholder ' +
      'is deleted and the code joins `UNTRANSLATED_ERROR_CODES` under `api_keys`. What ' +
      'would retire the entry is the raise passing its scope in `details`, at which point ' +
      'a sentence can name it.',
  },
  ADDRESS_IN_USE: {
    from: '_i18n',
    to: 'addresses',
    tier: 'T1',
    reason:
      'The noun is an address, which this module owns. Nothing in the tree raises it — T10 ' +
      'already ruled that ownership follows the noun rather than a raise site, so T1 runs ' +
      'before T3 here. Unraised is also why the placeholder is deleted rather than ' +
      'rewritten: with no raise site there is no refusal to describe, and the code joins ' +
      '`UNTRANSLATED_ERROR_CODES` under `addresses`.',
  },
  ADDRESS_NOT_OWNED: {
    from: '_i18n',
    to: 'addresses',
    tier: 'T1',
    reason:
      'The noun is an address and the refusal is about who owns it, which is this module\'s ' +
      'question about its own row. `orders` is the only raiser and reaches the row through ' +
      'this module\'s read port before placing an order, which makes it the caller and not ' +
      "the owner — D-95.2's `INVOICE_NOT_READY` shape. Placeholder deleted, prose written " +
      '(§5.4): the reader is a buyer at checkout and the refusal has one remedy to offer.',
  },
  WEBHOOK_DELIVERY_NOT_REPLAYABLE: {
    from: '_i18n',
    to: 'webhooks',
    tier: 'T1',
    reason:
      'The noun is a webhook delivery, this module\'s `webhook_deliveries` row, and the ' +
      'refusal is an invariant of that row\'s status — only `failed` and `dead_lettered` can ' +
      'be re-queued. Raised only here. Placeholder deleted, prose written (§5.4): the reader ' +
      'is an operator on the Webhooks screen, and the one thing the raise interpolates — the ' +
      'delivery\'s status — is on the row they pressed the button on.',
  },
  // ---- Tier C, MR 6 of the sweep: `admin_roles` (3). The first of the two
  // batches the sweep keeps unbatched because they carry prose somebody wrote,
  // and the module creates its i18n bundle in the same change. Noun and thrower
  // agree for all three — every raise site is in this module's
  // `services/admin-role-service.ts` — so the judgement here is not about the
  // destination but about what each sentence should say.
  ADMIN_ROLE_CODE_TAKEN: {
    from: '_i18n',
    to: 'admin_roles',
    tier: 'T1',
    reason:
      'The noun is an admin role and the refusal is of a second row under a code this ' +
      "module's `admin_roles` table already holds — a unique constraint of its own table, " +
      'raised from its own upsert. Placeholder deleted, prose written (§5.4): the reader is ' +
      'an operator saving a role on `/admin-roles`, and the remedy is one sentence long.',
  },
  ADMIN_ROLE_IN_USE: {
    from: '_i18n',
    to: 'admin_roles',
    tier: 'T1',
    reason:
      'The noun is an admin role and the refusal is of deleting one that assignees still ' +
      "hold. The sweep's only multi-token sentence: two raise sites, both passing a " +
      '`details.code` (`assigned`, `assigned_to_deleted`), so four of its six bundle keys ' +
      'are the sentences an operator actually reads and the base pair is unreachable. All ' +
      'six moved — carrying the base key rather than deleting it is measured and argued in ' +
      "this module's manifest, because P1 asks its question at `errors.<CODE>` and at no " +
      'other key.',
  },
  ADMIN_ROLE_PROTECTED: {
    from: '_i18n',
    to: 'admin_roles',
    tier: 'T1',
    reason:
      'Same noun and same owner: it refuses deleting a role another module seeded, and the ' +
      "protected set is this module's own `SYSTEM_ROLE_CODES` registry. Placeholder " +
      'deleted, prose written (§5.4) — with one repair first, since the raise interpolated ' +
      'the role code into its English message and passed no `details`, so a translated ' +
      'sentence would have rendered cleanly and lost it. The raise now carries ' +
      '`{ role: role.code }` and both sentences name it.',
  },
  // ---- Tier C, MR 7 of the sweep: `organizations` (8), the largest batch and
  // the last of Tier C. The module creates its i18n bundle in the same change.
  // Two of the eight are raised by a module that does not own them
  // (`ORG_OWNER_DEPLETION` by `customers`, `ORGANIZATION_SUSPENDED` by
  // `orders`), which is D-95.2's shape and D-186 §1's: the owner of a noun is
  // not required to be the module that throws about it. Two more are the
  // sweep's remaining always-tokened codes, so every sentence they had was
  // unreachable and the sub-keys an operator meets are written here for the
  // first time — D-190 is why the base pairs moved rather than being deleted.
  CANNOT_REVOKE_LAST_ADMIN_INVITE: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      "The noun is an organization invitation, this module's `organization_invitations` " +
      'row, and the invariant is this module\'s too: an organization may not be left with ' +
      'neither an active administrator nor a pending invitation for one. Raised once, in ' +
      "this module's `services/invitation-service.ts`. Placeholder deleted, prose written " +
      '(§5.4): the reader is an organization administrator revoking an invitation, and the ' +
      'remedy — send another one first — is one sentence long.',
  },
  EMAIL_ALREADY_IN_ORGANIZATION: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      'The noun is membership of an organization, which this module owns and invites into. ' +
      'Two raise sites, both in `services/invitation-service.ts` and both untokened — the ' +
      'address already belongs to a member, or a pending invitation for it already exists — ' +
      'so the one sentence written here has to cover both, and says so. Placeholder ' +
      'deleted, prose written (§5.4).',
  },
  EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      'The same noun one refusal over: the address is a member of a *different* ' +
      "organization, which only this module can know. Raised once, in this module's " +
      'invitation service. Placeholder deleted, prose written (§5.4) — the reader is the ' +
      'same organization administrator, and the two codes are deliberately different ' +
      'sentences because the remedy differs.',
  },
  ORGANIZATION_HAS_CHILDREN: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      'The noun is an organization and its sub-organizations, this module\'s own tree over ' +
      'the materialized `path` column; the refusal is backed by that table\'s ' +
      '`parent_id ON DELETE RESTRICT`. Raised once, from this module\'s admin delete route, ' +
      'and **always tokened** (`has_children`) — so the prose pair `_i18n` held rendered for ' +
      'nobody. The base pair moved under D-190 because P1 asks its question at ' +
      '`errors.<CODE>` and at no other key, and the `has_children` sentence an operator ' +
      'actually reads is written here for the first time.',
  },
  ORGANIZATION_SUSPENDED: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      "The noun is the organization's `status`, a column this module owns and moderates. " +
      '`orders` raises it once, at placement, which makes that module the caller and not ' +
      'the owner — D-95.2\'s shape for `INVOICE_NOT_READY` and D-186 §1\'s for `CUSTOMER_*`. ' +
      'Homing it with its thrower would put a sentence about an organization\'s lifecycle in ' +
      'a bundle that says nothing else about organizations. Placeholder deleted, prose ' +
      'written (§5.4): the reader is a buyer who cannot check out.',
  },
  ORGANIZATION_TAX_ID_EXISTS: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      "The noun is an organization's tax id — a unique constraint of this module's own " +
      'table, raised twice in `services/registration-service.ts` (the pre-check and the ' +
      'unique-violation catch behind it). Placeholder deleted, prose written (§5.4): the ' +
      'reader is a company registering an account, and the remedy is to sign in or ask the ' +
      'existing organization for an invitation.',
  },
  ORGANIZATION_TREE_INVALID: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      "The noun is the organization tree, this module's `path` mechanism and its two " +
      'invariants. Two raise sites, both in `services/organization-tree-service.ts` and ' +
      '**both tokened** (`cycle`, `max_depth_exceeded`), so its prose pair was unreachable ' +
      'as well; the base pair moved under D-190 and the two sub-keys are new. The depth ' +
      'raise also needed !1181\'s repair before its sentence could be written — it ' +
      'interpolated the bound into its English message and passed only the token, so a ' +
      'translated sentence would have rendered cleanly and lost the number. It now carries ' +
      '`maxDepth` beside the token, and never a second `code`.',
  },
  ORG_OWNER_DEPLETION: {
    from: '_i18n',
    to: 'organizations',
    tier: 'T1',
    reason:
      "The noun is an organization's administrator, and the invariant — an organization may " +
      'never be left with nobody able to manage it — is this module\'s, an organization ' +
      'being the unit of tenancy. All three raise sites are in `customers` (delete, block, ' +
      'unassign the last administrator), which makes that module the caller: the same ' +
      'reading D-186 §1 took for `CUSTOMER_NOT_FOUND`, homed with the owner of the record ' +
      'rather than with the service that throws about it. It had **no** sentence in either ' +
      'language and was on `UNTRANSLATED_ERROR_CODES`; one was written here (§5.4), which is ' +
      'the first time that ledger shrinks in this sweep.',
  },
};
