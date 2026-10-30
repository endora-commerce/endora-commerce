/**
 * Every error code an operator can see has a sentence, in both shipped
 * languages — and every sentence written anywhere is one an operator can reach.
 *
 * Two predicates over one population, and they are two halves of a bijection
 * (feature 082, D-127):
 *
 *   **P1** every routed key exists. For each code a registered module declares,
 *          the declarer's bundle has `errors.<CODE>` in `en` and `pl`.
 *          Ledgered by `UNTRANSLATED_ERROR_CODES`, two-way, may only shrink.
 *   **P2** every written key is a routed key. For each `errors.*` key in any
 *          module bundle, the module holding it is the module the routing map
 *          points at. Three kinds — `unreachable`, `duplicate`, `no-code` — and
 *          **no ledger**, deliberately: every repair is a JSON line moved or
 *          deleted plus at most one declaration line, so there is nothing to
 *          schedule. Four candidate exceptions were tested and refuted
 *          (`specs/082-error-code-ownership/rulings.md` § 7). If a fifth is
 *          found, record it there and add the ledger then — do not ship an
 *          empty one.
 *
 * Two more landed with feature 090's Phase 4, when the routing stopped being a
 * table this repository writes and became the modules' own declarations
 * (`specs/090-module-owned-error-codes/contracts/error-translation-population.md`
 * §2.2):
 *
 *   **P3** the platform's enumeration and the declarations agree, **in both
 *          directions** (FR-031). `undeclared-enum-member` is a member of
 *          `ERROR_CODES` no manifest declares; `undeclared-in-enum` is a code a
 *          module in this repository declares that `ERROR_CODES` does not hold.
 *          No ledger — every repair is one line in a manifest. It is also what
 *          replaces the thing the deleted prefix chain provided for free: the
 *          next `INVOICE_*` code nobody declares fails the build **naming the
 *          code**, instead of routing silently to `core`.
 *   **P4** no code is declared by two registered modules (`collision`). A
 *          contested code routes to neither claimant and the operator reads the
 *          raising code's own English, so it is never right to stand; no ledger,
 *          because an entry could only license one. This predicate was
 *          `test/unit/_i18n/error-code-declaration-uniqueness.test.ts` until
 *          Phase 4 — that file's own header scheduled the handover, and shipping
 *          both would be two readers of one derivation.
 *
 * One more landed with issue #441, because P1 counts a key as translated the
 * moment it holds a string:
 *
 *   **P5** every translation is a sentence in its own language. For each
 *          `errors.*` key in a bundle that is not the reference language's,
 *          the value is neither a `placeholder` — the code itself, lowercased,
 *          optionally behind a one-word label (`Błąd: product not found.`) —
 *          nor `same-as-english`, the reference sentence copied across under
 *          the same key. 137 Polish placeholders stood in the tree, counted as
 *          translated by P1, when this landed; every one was written as prose
 *          in the same change. **No ledger**: every repair is one sentence
 *          written, and the one legitimate identity — a value that is nothing
 *          but an interpolation, such as `{reason}` — carries no language and
 *          is excluded by its shape rather than by a list. If a sixth kind of
 *          legitimately identical value is found (a brand name, an acronym),
 *          add the ledger then, two-way like `UNTRANSLATED_ERROR_CODES` — do
 *          not ship an empty one.
 *
 *          The reference language is never compared with itself, but since
 *          issue #486 it is judged for its own placeholder shape: the code in
 *          **Title Case**, optionally behind a one-word label
 *          (`Product Not Found.`). That match is case-sensitive, because the
 *          honest English sentence for a `*_NOT_FOUND` code is often the same
 *          words in sentence case (`Order not found.`), which the
 *          case-insensitive rule for every other language would report. The
 *          English entries of the same 137 codes had that shape when it
 *          landed; every one was written as a sentence in the same change.
 *
 * Three more landed with issue #83, each a shape every predicate above passed
 * unjudged:
 *
 *   **P2's `malformed-key`** — a key under `errors.` that the key grammar cannot
 *          parse (`errors.configMissing`, `errors.reason.x`). Every predicate
 *          used to `continue` past it, so it was neither accepted nor reported,
 *          and the envelope composes nothing it could match. No ledger, on P2's
 *          terms. The one family on the tree when it landed was `price_lists`'
 *          grid reasons, read by that module's admin rather than the envelope;
 *          they moved to `grid.reason.*` in the same change.
 *   **P6** every token a code is **raised** with has a sentence in both
 *          languages. The envelope reads `errors.<CODE>.<token>` for a raise
 *          that carries `details.code` and never falls back to the base key, so
 *          P1 counting the base key said nothing about it. The token set is the
 *          literal tokens a static read of `new HttpError(…)` sites finds plus
 *          the manifest's declared `tokens`; a raise whose token the read
 *          cannot spell is counted (`tokenSitesUnresolved`) and judged
 *          through the declaration: since the maintainer's ruling of
 *          2026-10-30, a code raised that way **must** declare its `tokens`,
 *          and one that does not is `token-undeclared`. A code whose token
 *          set no declaration can state — an open set, or a value outside the
 *          token grammar — is ledgered by `UNDECLARABLE_TOKEN_ERROR_CODES`,
 *          two-way, may only shrink; its repair is at the raise.
 *          Three tokens rendered the thrower's English when it landed, and all
 *          three were written. No ledger: every repair is a sentence.
 *   **P7** a declared code something in the source tree names. The read counts
 *          any string literal or property name that is the code, outside its
 *          declaration and the contracts vocabularies, so a finding is a code
 *          nothing can possibly raise. Ledgered by `UNRAISED_ERROR_CODES`,
 *          two-way, may only shrink; what to do with each entry is a separate,
 *          maintainer-level question.
 *
 * P1 alone cannot see a sentence written in a bundle the table does not name,
 * and that is where issue #229's five defects lived: `carts` had finished
 * wording for two codes routed to `core`, and three more codes were shadowed by
 * a machine-shaped placeholder in the bundle routing did reach — in Polish,
 * `Błąd: order not found.` standing over `Nie znaleziono zamówienia.`
 *
 * The envelope's `preSerialization` hook replaces an error's message wholesale
 * with the bundle string for `errors.<CODE>`, resolved in the module that
 * declares the code. When that key is absent the
 * operator is shown the raw code — `CREDENTIAL_TYPE_IMMUTABLE` rather than a
 * sentence — and nothing anywhere reports it. That is how `credentials` came to
 * ship eight perfectly good sentences under `error.<camelCase>` keys, written
 * and translated, while every one of its six codes rendered untranslated:
 * the sentences existed, the mapping the envelope reads did not.
 *
 * A missing translation is invisible in exactly the way a missing test is: the
 * happy path never touches it, and the failing path is the one nobody demos. So
 * this is a build gate rather than a report.
 *
 * `UNTRANSLATED_ERROR_CODES` is the standing debt, and it is a **ratchet in both
 * directions**: a new code without a sentence fails, and a ledgered code that
 * has since been translated fails too, so the list cannot quietly describe a
 * problem that no longer exists. It is meant to shrink. Do not add to it to make
 * a build pass — add the sentence.
 *
 * ## The population, and the floor under it (issue #215, feature 080 T010)
 *
 * The bundle half **is** a module-tree walk, and it walks the tree by listing
 * `src/modules` rather than by resolving the registered module ids. That is
 * deliberate and it is P2's question: "is every sentence written *anywhere*
 * reachable?" A directory whose registration was dropped while its bundle
 * stayed on disk is precisely a sentence nothing reads, and re-rooting the walk
 * onto the manifest index would hide it — the index would no longer name it, so
 * the walk would stop opening it and the finding would disappear.
 *
 * The floor is what the index is for instead. Without one, a residue is not a
 * clean tree but it is the **wrong sentence**: move `blog`'s bundle and P1
 * reports nineteen untranslated codes, which sends an author to write nineteen
 * sentences that already exist somewhere else in the repository. Measured on the
 * tree this floor landed against, emptying any one of the eighteen routed
 * modules' bundles produces between 2 and 41 such findings and never zero — so
 * the old behaviour was loud, and loudly wrong.
 *
 * So the walk is reconciled against a population the generated manifest index
 * derives and the filesystem does not: the module ids it registers, intersected
 * with the modules that **declare** an error code. Every one of those must
 * contribute a bundle file, or the run exits 2 rather than reporting on a
 * residue. A registered module that declares no code is outside the floor by
 * design — nothing requires a module to ship an i18n bundle at all, and 45 of
 * the 66 registered modules ship one — which is the claim
 * {@link nonDeclaringModules} makes and the only exclusion the floor takes.
 *
 * It was *"the module directories `ERROR_TRANSLATION_KEYS` routes a code to"*
 * until Phase 4, and the two answers are the same eighteen modules on this tree
 * — the migration was answer-preserving over all 289 codes. What changed is what
 * the derivation reads: the manifests, per run, rather than a table with the
 * platform's own `core` in it.
 *
 * **The second reconciliation is `ERROR_CODES`** (P3, issue #244's grammar).
 * `sources` prints `error-codes:<accounted>/<enumerated>`, where a member is
 * accounted for by being declared **or** by being reported as
 * `undeclared-enum-member`. Two independent artefacts — the published
 * enumeration and the committed manifests — so it is a real corroboration and
 * not the same number twice; and a member that nobody declares stays a
 * *finding* that names the code rather than becoming a short walk, because
 * "nobody declares `NOT_FOUND`" is a defect to repair and a refusal that names
 * no code sends its reader nowhere. The token can only fall short if the
 * reconciliation stopped iterating the enumeration, which is this population's
 * #215.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
  type ErrorCodeCollision,
} from '../src/kernel/i18n/error-translation.js';
import {
  loadManifestErrorCodes,
  type ManifestErrorCodeDeclaration,
} from './lib/manifest-error-codes.js';
import {
  loadRegisteredModuleIds,
  refuseVacuousModulePopulation,
} from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';
import {
  PRUNED_DIRECTORIES,
  requireModuleLayout,
  resolveModuleLayout,
} from './lib/module-roots.js';

/**
 * Every module's own directory, by id (feature 080, T040a).
 *
 * It used to be `join(srcRoot, 'modules')` plus a `readdirSync` — one root,
 * listed. A module that has become a workspace package keeps its bundle at
 * `<package>/i18n/<language>.json` and is under no such root, so a listing
 * answers for the modules that stayed and silently for none of the others.
 * `resolveModuleLayout().moduleDirectories` is the enumeration instead.
 */
export type ModuleDirectories = ReadonlyMap<string, string>;

/** The languages every user-facing string ships in (Principle VIII). */
const LANGUAGES = ['en', 'pl'] as const;

/**
 * The language every other bundle is a translation of (P5). Its sentences are
 * the reference a copied value is compared against, so it is never compared
 * with itself; it is judged only for its own placeholder shape (issue #486).
 */
const REFERENCE_LANGUAGE = 'en';

/**
 * Codes with no sentence in either language, first measured on 2026-08-16.
 *
 * They are listed rather than swept because writing a sentence in two languages
 * is content work with a house voice, not a mechanical edit, and a batch of
 * machine-shaped strings is what produced the 169 Polish placeholders already in
 * the tree (`Błąd: <the english code, lowercased>`). Those satisfy a checker and
 * help nobody, which is the outcome this ledger exists to avoid repeating.
 * (The number this sentence carried, 181, was taken on a tree older than the one
 * it shipped against and was three high; 169 is measured here. The count is kept
 * rather than dropped because the placeholder story is the reason this ledger
 * exists at all.)
 *
 * **Read the `_i18n` block as "declared by the platform's own module", not
 * "owned by the kernel."** They sit in the platform bundle because the deleted
 * prefix chain had no rule for them and its last line was `return 'core'`;
 * feature 090's Phase 3 declared them where the chain answered, verbatim,
 * because an answer-preserving migration and a re-routing sweep in one change is
 * unreviewable (`contracts/error-code-declaration.md` §6.5).
 *
 * **D-129's sweep is what re-routes them, and it is running.** D-121 decides each
 * destination — 79 codes into 20 modules, 21 staying — and the batches land one
 * merge request at a time (`specs/090-module-owned-error-codes/d129-sweep.md`
 * §5.2, Appendix A). `KSEF_*` and `PIM_ERGONODE_*` went first (MR 2), then the
 * rest of Tier A — `custom_fields`, `customers`, `price_lists`,
 * `prompt_actions`, `shopping_lists` and `transactional_emails` (MR 3) — then
 * Tier B's six receivers that already ship a bundle: `catalog`,
 * `customer_accounts`, `orders`, `mfa`, `newsletter` and `promotions` (MR 4) —
 * then Tier B's four that had to create one: `credit_limits`, `api_keys`,
 * `addresses` and `webhooks` (MR 5).
 * That is why those modules now have groups of their own below. Draining a block
 * still means two edits: the declaration moves to the owning module's manifest,
 * and the sentences move to its bundle. A group here whose codes carry no
 * sentence needs only the first, and its entries stay — the debt is unchanged,
 * only its owner is.
 *
 * **`shopping_lists` is the exception, and it is the shape to copy rather than
 * the shape to note.** Its two codes had no sentence either, and it is one of
 * the seven receiving modules that had to create an i18n bundle in the same
 * merge request — a declaring module that contributes no bundle file is exit 2
 * for this whole check. `d129-sweep.md` §5.4 makes an empty `{}` the default in
 * that position and says in terms that writing the prose instead is always
 * available and is not a re-opening of D-186 §2, which refuses *carrying* a
 * placeholder rather than *writing* a sentence. Both were written, so the two
 * codes left this ledger instead of joining a new group in it: 67 entries down
 * to 65, which is the one direction this list is ever allowed to move on its
 * own.
 *
 * **MR 4 moved it the other way, 65 to 69, and that direction is authorised
 * rather than excused.** Tier B is where the sweep first meets codes that
 * already *have* a sentence, and twenty-four of the sweep's twenty-seven are the
 * code rewritten twice — `"Promotion Invalid."` / `"Błąd: promotion invalid."`.
 * D-186 §2 deletes such a placeholder instead of moving it, because in the
 * receiving module's own bundle it reads as that module's answer, every
 * instrument then counts the code as translated, and it is never reportable
 * again; the ruling authorises the resulting growth here explicitly, as a
 * reclassification of debt that already existed rather than a ratchet being
 * raised. MR 4 carried eight such placeholders and **wrote four of them as
 * prose** instead of ledgering them — `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`,
 * `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and
 * `CURRENCY_MISMATCH`, each with a raise site that says what the refusal means
 * and a reader who meets it. The other four are codes **nothing in the tree
 * raises**: with no raise site there is no refusal to describe, and a sentence
 * could only have been invented from the code's own name, which is the
 * placeholder again in longer words. Those four are the +4.
 *
 * **MR 5 moved it 69 to 72, and one of the three is a shape this ledger has not
 * held before.** Its four receivers each created their first bundle in that
 * change, and nine placeholders left `_i18n`'s: six were written as prose and
 * three were not. Two of the three are MR 4's grounds again —
 * `ACTIVE_RESERVATIONS_EXIST` and `ADDRESS_IN_USE` are raised by nothing in the
 * tree. `API_KEY_OUT_OF_SCOPE` is the new one: it **has** a live raise site, and
 * it is ledgered because its reader is an integration rather than a person and
 * because the raise names the scope the key is missing
 * (`API key lacks the required scope: <scope>.`). `localizeErrorEnvelope`
 * substitutes the message wholesale, and that raise passes no `details` for a
 * placeholder to be filled from, so writing the sentence would take information
 * away from the only audience that meets it. An entry here for that reason is
 * not "nobody has written it yet" either — the note on its group says what would
 * retire it.
 *
 * **MR 6 moved it not at all, and that is the third answer this ledger can
 * give.** Tier C's `admin_roles` took three codes and wrote all three as prose
 * in its own new bundle: each has a live raise site in that module, and each
 * has a reader — an operator on `/admin-roles` saving a role or pressing
 * Delete on a row — so there was a refusal to describe and somebody to describe
 * it to. Two of the three replaced a placeholder here; the third,
 * `ADMIN_ROLE_IN_USE`, already carried prose and moved it. A batch whose codes
 * all arrive translated leaves this list where it found it, which is what the
 * sweep is for.
 *
 * **MR 7 moved it down, 72 to 71, and that is the fourth answer and the one
 * this list exists for.** Tier C's `organizations` took eight codes and wrote
 * all eight as prose in its own new bundle. Five replaced a placeholder here
 * and two already carried prose — but `ORG_OWNER_DEPLETION` had no sentence in
 * either language and was an entry in the `_i18n` group below, so it **leaves**
 * this list. Nothing about the code changed to allow that: it had three live
 * raise sites in `customers` all along, each naming what it refuses (deleting,
 * blocking or unassigning an organization's last administrator), and a reader —
 * an operator on `/customers`. What it did not have was an owner who would
 * notice, which is the whole of D-129. The one direction this list may move on
 * its own is down, and this is it.
 *
 * So the rule is unchanged and is worth stating in the form the sweep needs it:
 * never add an entry to make a build pass, and never carry a placeholder to
 * avoid adding one.
 *
 * `MFA_*` is the worked example, and it took both edits and two issues: #194
 * routed the family to `mfa`, #223 wrote the nine sentences in `mfa`'s own
 * bundle. In between, the family was routed correctly and still untranslated,
 * and this ledger read exactly as it had before — which is the thing to notice.
 * Nothing *in this list* distinguishes "no sentence written yet" from "no
 * sentence could ever have been found", so a code listed under `_i18n` says
 * nothing about whether its bundle is reachable at all.
 *
 * **P2 is what distinguishes them now**, and it is not a ledger. Two entries
 * that stood here until issue #231 were the second kind — `CART_COUPON_REJECTED`
 * and `CART_LINE_CAP_EXCEEDED` had finished sentences in both languages in
 * `carts`' own bundle while routing pointed at `core`, which had neither, so
 * "untranslated" was the wrong word for them and the repair was a routing
 * decision rather than a piece of writing. That shape is now a hard
 * `unreachable` finding with no ledger to absorb it, so it cannot be filed here
 * again by mistake. An entry below is a code with **no sentence anywhere**.
 *
 * Grouped as measured, so a module can drain its own block.
 */
export const UNTRANSLATED_ERROR_CODES: ReadonlySet<string> = new Set([
  // _i18n (7) — `ORG_OWNER_DEPLETION` was the eighth until D-129's sweep, MR 7:
  // it went to `organizations` with a sentence written in that module's own new
  // bundle, so it left this list rather than moving group. Of the seven left,
  // six are the platform's own `MODULE_*` vocabulary and the seventh is the one
  // code the sweep leaves with two claimants (`d129-sweep.md` §2.4).
  'MODULE_ACTIVATION_PROTECTED', 'MODULE_DEPENDENCIES_ABSENT', 'MODULE_DEPENDENTS_PRESENT',
  'MODULE_NOT_DEACTIVATABLE', 'MODULE_NOT_FOUND', 'MODULE_SETTING_READ_ONLY',
  'PRICE_UNAVAILABLE',
  // addresses (1) — MR 5. `ADDRESS_NOT_OWNED` moved with it and is not here: it
  // carried a placeholder and arrives with prose in this module's own bundle.
  // This one is unraised, so its placeholder was deleted rather than rewritten.
  'ADDRESS_IN_USE',
  // api_keys (0) — MR 5 put three codes here. `API_KEY_OUT_OF_SCOPE` left
  // first: it was held back because the raise names the scope the key is
  // missing and passed no `details` for a placeholder to be filled from, and
  // issue #86 gave the raise `details.requiredScope` and the bundle a sentence
  // that interpolates it. `API_KEY_CHANNEL_MISMATCH` and `API_KEY_NOT_BOUND`
  // followed under the same issue: their raises write a fixed sentence and
  // carry no value, so the bundle sentence is that sentence in both languages,
  // with no placeholder to go unfilled.
  // catalog (12) — seven from Phase 3, five re-homed from `_i18n` by D-129's
  // sweep, MR 4 (Tier B). The five had no sentence in either language before
  // the move and none after, so what moved is which module owes it. The batch's
  // sixth `catalog` code, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`, is not here: it
  // carried a placeholder in `_i18n`'s bundle and arrives with real prose in
  // this module's own, which is `d129-sweep.md` §5.4's available option taken
  // rather than a re-opening of D-186 §2.
  'ATTRIBUTE_NOT_MASS_EDITABLE', 'BULK_TOO_LARGE',
  'PACKAGING_UNIT_NAME_CONFLICT', 'PACKAGING_UNIT_NOT_FOUND',
  'PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE',
  'PRODUCT_FEED_CONFIRMATION_REQUIRED', 'PRODUCT_FEED_DISABLED',
  'PRODUCT_FEED_TAXONOMY_CONFLICT', 'PRODUCT_FEED_TEMPLATE_CONFLICT', 'PRODUCT_FEED_TEMPLATE_UNBOUND',
  'SELECTION_TOO_LARGE', 'SKU_NOT_IN_ASSORTMENT',
  // credit_limits (1) — MR 5. The batch's other four `credit_limits` codes all
  // carried placeholders and arrive with prose in that module's own bundle, so
  // they are not here. This one is unraised: nothing in the tree throws it, so
  // there was no refusal to describe.
  'ACTIVE_RESERVATIONS_EXIST',
  // custom_fields (5) — re-homed from `_i18n` by D-129's sweep, MR 3 (Tier A),
  // on the same terms as MR 2's two families: none of the five had a sentence
  // in either language before the move and none has one after, so what moved is
  // which module owes it.
  'CUSTOM_FIELD_DEFINITION_INVALID', 'CUSTOM_FIELD_HOST_MANAGED', 'CUSTOM_FIELD_KEY_CONFLICT',
  'CUSTOM_FIELD_NOT_FOUND', 'CUSTOM_FIELD_VALUE_INVALID',
  // customer_accounts (5) — MR 4, same terms. The batch's other two
  // `customer_accounts` codes, `CANNOT_DEMOTE_LAST_ADMIN` and
  // `CANNOT_REMOVE_LAST_ADMIN`, carried placeholders and arrive with prose, so
  // they are not here. Two of the five — `CUSTOMER_ALREADY_DELETED` and
  // `CUSTOMER_NOT_FOUND` — are raised by `customers` and owned here, which is
  // D-186 §1's split of the `CUSTOMER_*` family and D-95.2's shape.
  'ACCOUNT_BLOCKED',
  'CUSTOMER_ALREADY_DELETED', 'CUSTOMER_NOT_DELETED', 'CUSTOMER_NOT_FOUND',
  'CUSTOMER_RESTORE_WINDOW_ELAPSED',
  // customers (2) — same move, same merge request. The four `CUSTOMER_*` record
  // codes went to `customer_accounts` in MR 4, which is D-186 §1's split: the
  // record is that module's and only the address one is this module's — even
  // though this module raises two of the four.
  'CUSTOMER_ADDRESS_NOT_FOUND', 'REGISTRATION_REQUIRES_ORGANIZATION',
  // ksef's seven, re-homed from `_i18n` by D-129's sweep (MR 2, Tier A), left the
  // repository with the module (feature 134, T069).
  // mfa (2) — MR 4, and the two entries whose reason is not "nobody has written
  // it yet". Nothing in the tree raises either code, so the placeholder each
  // carried in `_i18n`'s bundle was deleted rather than rewritten: with no
  // raise site there is no refusal to describe, and a sentence would have to be
  // invented from the code's own name. That is the growth D-186 §2 authorises
  // explicitly — a reclassification of debt that already existed, not a ratchet
  // being raised.
  'TWO_FACTOR_REQUIRED', 'TWO_FACTOR_REQUIRED_BY_ROLE',
  // newsletter (1) — MR 4, on the mfa entries' terms: unraised, so the
  // placeholder went rather than becoming this module's answer.
  'ALREADY_SUBSCRIBED',
  // orders (2) — MR 4. Both are answered to a machine posting orders over the
  // external intake API. The batch's third `orders` code, `CURRENCY_MISMATCH`,
  // carried a placeholder and arrives with prose, so it is not here.
  'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED',
  // pim_ergonode's thirteen, re-homed in the same MR on the same terms, left the
  // repository with the module (feature 134, T055).
  // price_lists (1) — MR 3. `pim_ergonode` raises it and does not own it, which
  // is why MR 2 moved thirteen of that module's codes and left this one.
  'PRICE_LIST_NOT_FOUND',
  // promotions (1) — MR 4, same terms as `mfa` and `newsletter`: nothing raises
  // it, so the placeholder was deleted rather than rewritten.
  'PROMOTION_INVALID',
  // prompt_actions (6) — MR 3, same terms.
  'ASSISTANT_DISABLED', 'ASSISTANT_NOT_CONFIGURED', 'PROMPT_PERMISSION_REVOKED',
  'PROMPT_PLAN_EXPIRED', 'PROMPT_REQUEST_INVALID_STATE', 'PROMPT_REQUEST_IN_FLIGHT',
  // settings (1)
  'SETTING_SECRET_KEY_MISSING',
  // transactional_emails — `TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` left this
  // list with issue #569: its raise carries the e-mail as `details.emailCode`
  // rather than as a token, so the base sentence written then is the one read.
]);

/**
 * Declared codes nothing in the source tree names (P7, issue #83), measured
 * when the predicate landed: 34 codes across 18 modules. Grouped by declaring
 * module, so a module can drain its own block.
 *
 * **A ledger of facts, not of verdicts.** Each entry is a code a module
 * declares, `ERROR_CODES` enumerates and — for most of them — a bundle
 * translates, while no source file outside its declaration spells it. Whether
 * each one should be raised somewhere, or leave the vocabulary with its
 * sentences, is a maintainer's decision per code and is deliberately not taken
 * here; several of them are already on {@link UNTRANSLATED_ERROR_CODES} on the
 * same ground ("nothing in the tree raises it").
 *
 * Two-way, like that ledger: a new declared code nobody raises fails, and an
 * entry the tree has since started naming fails too, so the list can only
 * shrink. Do not add to it to make a build pass — raise the code, or drop it.
 */
export const UNRAISED_ERROR_CODES: ReadonlySet<string> = new Set([
  // _i18n (1)
  'TERMS_VERSION_STALE',
  // addresses (1) — also on UNTRANSLATED_ERROR_CODES, on this ground.
  'ADDRESS_IN_USE',
  // assets_library (1)
  'ASSET_STORAGE_MISCONFIGURED',
  // blog (5)
  'BLOG_ASSET_KIND_MISMATCH', 'BLOG_CATEGORY_NO_CHANNEL', 'BLOG_POST_NO_CHANNEL',
  'BLOG_POST_NO_LANGUAGE', 'BLOG_SLUG_INVALID',
  // catalog (3)
  'FIELD_IMMUTABLE', 'VARIANT_AXIS_MISSING', 'VARIANT_COMBINATION_EXISTS',
  // cms (1)
  'CMS_SCHEMA_UPGRADE_FAILED',
  // credit_limits (1) — also on UNTRANSLATED_ERROR_CODES, on this ground.
  'ACTIVE_RESERVATIONS_EXIST',
  // dictionaries (2)
  'DICTIONARY_CODE_IMMUTABLE', 'DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE',
  // inventory (4)
  'STOCK_IMPORT_INVALID_FILE', 'STOCK_LEVEL_NOT_FOUND', 'THRESHOLDS_INVALID',
  'WAREHOUSE_INVALID_CODE',
  // invoice_ledger (1)
  'INVOICE_LEDGER_CREDENTIALS_MISSING',
  // megamenu (1)
  'MEGAMENU_REFERENCED',
  // mfa (2) — also on UNTRANSLATED_ERROR_CODES, on this ground.
  'TWO_FACTOR_REQUIRED', 'TWO_FACTOR_REQUIRED_BY_ROLE',
  // newsletter (1) — also on UNTRANSLATED_ERROR_CODES, on this ground.
  'ALREADY_SUBSCRIBED',
  // price_lists (1) — also on UNTRANSLATED_ERROR_CODES, whose note names
  // `pim_ergonode` as its raiser; that module has since left the repository.
  'PRICE_LIST_NOT_FOUND',
  // promotions (1) — also on UNTRANSLATED_ERROR_CODES, on this ground.
  'PROMOTION_INVALID',
  // quote_requests (3)
  'RFQ_ALREADY_CLAIMED', 'RFQ_NOT_ACCEPTED', 'RFQ_NOT_NEW',
  // sales_channels (3)
  'SALES_CHANNEL_ATTRIBUTION_IMMUTABLE', 'UNKNOWN_CURRENCY_CODE', 'UNKNOWN_LANGUAGE_CODE',
  // settings (2)
  'SETTING_BREAKING_CHANGE_REJECTED', 'SETTING_CODE_CONFLICT',
]);

/**
 * Codes raised with a computed `details.code` whose token set **cannot** be
 * declared (P6's `token-undeclared`, issue #83), measured when the predicate
 * landed: three codes, all three since repaired at their raises (issue
 * #569). Two-way like the ledgers above — a new such code fails,
 * and an entry whose raise has since been given a declarable token set fails
 * too — and it may only shrink.
 *
 * Every entry is the same defect seen from the check: the raise puts a
 * **value** under `details.code`, where the envelope expects a refusal token,
 * so the envelope looks up `errors.<CODE>.<value>`, finds nothing, and the
 * operator reads the thrower's English in every language — the base sentence,
 * where one is written, is never read. The repair is at the raise (move the
 * value to a member of its own name, and keep `code` for a token, or drop it),
 * not in the manifest, which is why each entry is ledgered here instead of
 * declared.
 */
export const UNDECLARABLE_TOKEN_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  // Empty since issue #569. The three entries it landed with —
  // `AMOUNT_PRECISION_EXCEEDED` (`orders`' minimum-order-value validator),
  // `TASK_PRIORITY_UNKNOWN` and `TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE` — were
  // repaired at their raises, which now carry the value as `details.setting`,
  // `details.priorityCode` and `details.emailCode` and no `details.code`.
]);

export interface Finding {
  readonly code: string;
  readonly moduleId: string;
  readonly missingIn: readonly string[];
}

/** Where a code is routed: the module owning the bundle, and the key inside it. */
export interface ErrorTranslationTarget {
  readonly moduleId: string;
  readonly key: string;
}

/**
 * What the analysis reads, injected so the rule's own test can drive it red on a
 * tree this repository does not contain. Every member enters at the top of the
 * analysis (issue #130): none of them is a value the check would otherwise
 * compute for itself.
 */
export interface TranslationInput {
  /**
   * P1 and P2: where each declared code's sentence lives — the `targets` half of
   * `buildErrorTranslationTargets`, keyed by code.
   */
  readonly keys: Readonly<Record<string, ErrorTranslationTarget>>;
  /**
   * P4: the codes more than one registered module declares, from the **same**
   * call that produced {@link TranslationInput.keys}.
   *
   * One derivation, so the routing and the report cannot come to disagree about
   * which codes are contested (D-100). A contested code is absent from `keys`,
   * which is why the report has to travel beside it rather than be recomputed
   * from it — from `keys` alone a contested code is indistinguishable from one
   * nobody declared.
   */
  readonly collisions: readonly ErrorCodeCollision[];
  /**
   * P3's reference side: the platform's published vocabulary, `ERROR_CODES`.
   *
   * Injected rather than imported inside the analysis so a proof can hand the
   * reconciliation an enumeration the tree does not have — and so the "the
   * enumeration came back empty" refusal is reachable at all.
   */
  readonly enumeratedCodes: readonly string[];
  /** P1: the bundle for `moduleId` in `language`, as a flat key → value map. */
  readonly readBundle: (moduleId: string, language: string) => Record<string, unknown>;
  /**
   * P2: every `errors.*` key written anywhere, with the bundle that holds it.
   *
   * A separate member because `readBundle(moduleId, language)` can only read the
   * bundle the routing map names, and P2's whole question is about the bundles
   * it does not name.
   */
  readonly listBundleKeys: () => Iterable<BundleKey>;
  /**
   * P6: the refusal tokens each code's declaring manifest names, keyed by code
   * (`errorCodes[].tokens`). Contested codes are absent, as they are from
   * {@link TranslationInput.keys}.
   */
  readonly declaredTokens: Readonly<Record<string, readonly string[]>>;
  /**
   * P6 and P7: every source file the raise walk reads, as text — the top of the
   * analysis, so a proof hands it source and never a pre-read raise site.
   */
  readonly listSources: () => Iterable<SourceFile>;
}

/** Which way the enumeration and the declarations disagree (P3, FR-031). */
export type ReconciliationFindingKind = 'undeclared-enum-member' | 'undeclared-in-enum';

export interface ReconciliationFinding {
  readonly code: string;
  readonly kind: ReconciliationFindingKind;
  /** The declaring module, for `undeclared-in-enum`; `null` the other way. */
  readonly moduleId: string | null;
  readonly repair: string;
}

/** One `errors.*` key as it is written on disk. */
export interface BundleKey {
  readonly moduleId: string;
  readonly language: string;
  readonly key: string;
}

/**
 * Why a written sentence is not the sentence anything reads.
 *
 * `malformed-key` is issue #83's first slice: a key under `errors.` that
 * {@link ERROR_KEY} cannot parse. Every predicate used to `continue` past it,
 * so a sentence filed under a mis-cased code (`errors.configMissing`) was
 * neither accepted nor reported — and the envelope composes only
 * `errors.<CODE>` or `errors.<CODE>.<token>`, so nothing it renders reads one.
 */
export type SentenceFindingKind = 'unreachable' | 'duplicate' | 'no-code' | 'malformed-key';

export interface SentenceFinding extends BundleKey {
  /**
   * The base code, with any `.<token>` suffix resolved away — or, for
   * `malformed-key`, everything after `errors.`, since there is no code to
   * resolve.
   */
  readonly code: string;
  readonly kind: SentenceFindingKind;
  /** The directory the routing map points at, or `null` for `no-code` and `malformed-key`. */
  readonly routedModuleId: string | null;
  readonly repair: string;
}

/**
 * The module **directories** the routing map names.
 *
 * These are the bundles P1 reads, so they are the ones a run has to have opened.
 * Derived on every run from the map itself, never written down: a module that
 * stops declaring a code leaves this set in the same run (D-100).
 *
 * **There is no rename left to apply.** It carried `core` -> `_i18n` until
 * Phase 4, because the prefix chain answered a bundle *namespace* where every
 * other answer was a module id. The map is now the modules' own declarations, so
 * every `moduleId` in it is a registered module and `core` is produced by
 * nothing. The one surviving statement of that identity is on the resolver's
 * read side, in `_i18n`'s own `i18n-service.ts` (D-185) — a client asks for
 * `core` because the admin SPA has called the bundle that since feature 019, and
 * no other module has a legacy namespace.
 */
export function declaringBundleDirectories(
  keys: Readonly<Record<string, ErrorTranslationTarget>>,
): string[] {
  return [...new Set(Object.values(keys).map((target) => target.moduleId))].sort();
}

/**
 * Registered modules the population floor does not ask for — the complement of
 * {@link declaringBundleDirectories} inside the registered set.
 *
 * This is the check's one exclusion claim, and it is a claim rather than a
 * convenience: a module that declares no error code is not required to ship an
 * i18n bundle, and most do not carry an `errors.*` key even when they ship one.
 * Asking every registered module for a bundle would make the floor a list of
 * twenty exceptions, which is a floor nobody can read.
 */
export function nonDeclaringModules(
  keys: Readonly<Record<string, ErrorTranslationTarget>>,
  registered: readonly string[],
): string[] {
  const declaring = new Set(declaringBundleDirectories(keys));
  return registered.filter((id) => !declaring.has(id));
}

function bundlePath(
  directories: ModuleDirectories,
  moduleId: string,
  language: string,
): string | null {
  const dir = directories.get(moduleId);
  return dir === undefined ? null : join(dir, 'i18n', `${language}.json`);
}

function loadBundle(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A malformed bundle is `registered-bundles-shape.test.ts`'s finding, not
    // this check's — reporting it twice would make one of them the noisy one.
    return {};
  }
}

/** Reads a module's on-disk bundle, memoised — the tree's {@link TranslationInput}. */
export function diskBundleReader(directories: ModuleDirectories): TranslationInput['readBundle'] {
  const cache = new Map<string, Record<string, unknown>>();
  return (moduleId: string, language: string): Record<string, unknown> => {
    // A module the layout does not know is a module with no directory to read a
    // bundle from, which is the same answer `loadBundle` gives for a file that
    // is not there — and P1 reports every code routed to it, loudly.
    const path = bundlePath(directories, moduleId, language);
    if (path === null) return {};
    let bundle = cache.get(path);
    if (!bundle) {
      bundle = loadBundle(path);
      cache.set(path, bundle);
    }
    return bundle;
  };
}

/**
 * Every `errors.*` key written in a module bundle — every `i18n/en.json` and
 * `i18n/pl.json` under `src/modules/` — and the
 * default {@link TranslationInput.listBundleKeys}.
 *
 * Overlay bundles under `src/apps/**` are outside the population: zero exist
 * today, and if one ever ships a bundle the extension is one path and the
 * findings are the same findings.
 */
export function diskBundleKeyWalker(
  directories: ModuleDirectories,
): TranslationInput['listBundleKeys'] {
  return function* walk(): Generator<BundleKey> {
    for (const moduleId of [...directories.keys()].sort()) {
      for (const language of LANGUAGES) {
        const bundle = loadBundle(join(directories.get(moduleId)!, 'i18n', `${language}.json`));
        for (const key of Object.keys(bundle)) {
          if (key.startsWith('errors.')) yield { moduleId, language, key };
        }
      }
    }
  };
}

/**
 * The tree's own input, over the layout's module directories and the manifests
 * the generated index registers.
 *
 * Async since feature 080's T040a, because "where does module `x` keep its
 * bundle" is now a question about the workspace rather than about one path —
 * and since Phase 4 for a second reason: "which module owns code `x`" is a
 * question about the manifests rather than about a static table. Every caller
 * that means *this repository* — the CLI and the tree tests — goes through it,
 * so there is one derivation and not a default beside it.
 */
export async function treeTranslationInput(): Promise<TranslationInput> {
  const layout = await resolveModuleLayout();
  const declarations = await loadManifestErrorCodes(layout.manifestIndexPath);
  return translationInputFor(declarations, layout.moduleDirectories, raiseWalkRoots(layout));
}

/**
 * Where the raise walk looks (P6, P7): the application's source tree, the
 * platform package's and every module package's — `layout.sourceRoots`, the
 * derivation every other whole-tree check reads (feature 080, T040a) — plus the
 * sources of the package that publishes the vocabulary.
 *
 * The last one is not a formality. `@endora-commerce/contracts` builds some
 * refusals itself — `order-minimums.ts` composes the
 * `PRODUCT_BELOW_MINIMUM_QUANTITY` envelope `carts` and `quote_requests` throw —
 * so a walk without it reports those codes as raised by nobody. It is found by
 * the name the check already imports `ERROR_CODES` from, never by a path.
 */
export function raiseWalkRoots(layout: {
  readonly sourceRoots: readonly string[];
  readonly repoRoot: string;
}): string[] {
  const vocabulary = workspaceMembers(layout.repoRoot, nodeWorkspaceFs()).find(
    (member) => member.name === VOCABULARY_PACKAGE,
  );
  return vocabulary === undefined
    ? [...layout.sourceRoots]
    : [...layout.sourceRoots, join(vocabulary.dir, 'src')];
}

/** The package `ERROR_CODES` is imported from, above. */
const VOCABULARY_PACKAGE = '@endora-commerce/contracts';

/**
 * What a raise can never sit in, so the walk does not open it.
 *
 * - a test (`*.test.ts`, `*.spec.ts`): a test names a code to assert on it;
 * - a declaration file;
 * - a module's `manifest.ts`, which is where a code is **declared** — counting
 *   that spelling would make every declared code its own raise site;
 * - a module's `src/admin/` tree, which is the operator's UI — it reads a code
 *   off a response and raises none.
 */
function isRaiseCandidate(path: string): boolean {
  const name = basename(path);
  if (!/\.tsx?$/.test(name) || name.endsWith('.d.ts')) return false;
  if (/\.(test|spec)\.tsx?$/.test(name)) return false;
  if (name === 'manifest.ts') return false;
  return !path.split(sep).join('/').includes('/src/admin/');
}

function sourceFilesUnder(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    if (PRUNED_DIRECTORIES.includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFilesUnder(full, out);
    else if (isRaiseCandidate(full)) out.push(full);
  }
}

/** The default {@link TranslationInput.listSources}: every raise candidate under `roots`. */
export function diskSourceWalker(roots: readonly string[]): TranslationInput['listSources'] {
  // Memoised: the CLI asks once for the population floor and once for the
  // analysis, and both have to be the same walk.
  let files: readonly SourceFile[] | null = null;
  return (): Iterable<SourceFile> => {
    if (files === null) {
      const found: string[] = [];
      for (const root of roots) sourceFilesUnder(root, found);
      files = [...new Set(found)].sort().map((path) => ({ path, text: readFileSync(path, 'utf8') }));
    }
    return files;
  };
}

/**
 * The same input over a given set of declarations and module directories.
 *
 * The routing is derived here, by the **same** function the composition roots
 * call, so the gate and the running platform cannot come to disagree about where
 * a sentence is looked for. `collisions` travels out of that one call for the
 * same reason (D-100).
 */
export function translationInputFor(
  declarations: readonly ManifestErrorCodeDeclaration[],
  directories: ModuleDirectories,
  sourceRoots: readonly string[],
  enumeratedCodes: readonly string[] = Object.values(ERROR_CODES),
): TranslationInput {
  const { targets, collisions } = buildErrorTranslationTargets(declarations);
  return {
    keys: targets,
    collisions,
    enumeratedCodes,
    readBundle: diskBundleReader(directories),
    listBundleKeys: diskBundleKeyWalker(directories),
    declaredTokens: declaredTokensOf(declarations, targets),
    listSources: diskSourceWalker(sourceRoots),
  };
}

/**
 * `errorCodes[].tokens`, keyed by code, for the codes the routing resolved.
 * A contested code has no route, so the declaration it would be read against
 * is ambiguous — P4 reports it and P6 does not guess.
 *
 * **An empty list is kept**, because it is a statement and not an absence:
 * `tokens: []` says the code is raised with a `details` the static read cannot
 * see into — a parameter handed down by a helper, a caught error's `details` —
 * and that none of the values it can take carries a `code`. It is what
 * answers `token-undeclared` for such a raise without inventing a token.
 */
export function declaredTokensOf(
  declarations: readonly ManifestErrorCodeDeclaration[],
  targets: Readonly<Record<string, ErrorTranslationTarget>>,
): Record<string, readonly string[]> {
  const tokens: Record<string, readonly string[]> = {};
  for (const declaration of declarations) {
    for (const code of declaration.manifest.errorCodes ?? []) {
      if (targets[code.code]?.moduleId !== declaration.manifest.id) continue;
      if (code.tokens !== undefined) tokens[code.code] = [...code.tokens];
    }
  }
  return tokens;
}

/**
 * P3 — the platform's enumeration and the modules' declarations, reconciled in
 * both directions (FR-031).
 *
 * A **contested** code counts as declared: it is P4's finding, and reporting it
 * here as well would send its author to write a declaration that already exists
 * twice.
 *
 * This is what replaces the one thing the deleted prefix chain gave for free.
 * The chain's last line was `return 'core'`, so a new code nobody thought about
 * routed silently to the platform bundle and rendered as a raw code forever; the
 * derivation has no fall-through (§4.1), so the same code now fails the build
 * with its own name in the message.
 */
export function reconcileEnumeration(
  input: Pick<TranslationInput, 'keys' | 'collisions' | 'enumeratedCodes'>,
): ReconciliationFinding[] {
  const declared = new Map<string, string | null>(
    Object.entries(input.keys).map(([code, target]) => [code, target.moduleId]),
  );
  for (const collision of input.collisions) declared.set(collision.code, null);

  const enumerated = new Set(input.enumeratedCodes);
  const findings: ReconciliationFinding[] = [];
  for (const code of input.enumeratedCodes) {
    if (declared.has(code)) continue;
    findings.push({
      code,
      kind: 'undeclared-enum-member',
      moduleId: null,
      repair:
        'ERROR_CODES holds it and no manifest declares it, so it routes nowhere and the ' +
        "operator reads the raising code's own English — add { code: '" +
        `${code}' } to the errorCodes of the module that owns it`,
    });
  }
  for (const [code, moduleId] of declared) {
    if (enumerated.has(code)) continue;
    findings.push({
      code,
      kind: 'undeclared-in-enum',
      moduleId,
      repair:
        `${moduleId ?? 'more than one module'} declares it and ERROR_CODES does not hold ` +
        'it — a module this repository ships declares out of the platform vocabulary ' +
        '(FR-043), so add it to packages/contracts/src/errors.ts or drop the declaration',
    });
  }
  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code));
}

export function findUntranslatedErrorCodes(
  input: Pick<TranslationInput, 'keys' | 'readBundle'>,
): Finding[] {
  const read = input.readBundle;

  const findings: Finding[] = [];
  for (const [code, target] of Object.entries(input.keys)) {
    const missingIn = LANGUAGES.filter(
      (language) => typeof read(target.moduleId, language)[target.key] !== 'string',
    );
    if (missingIn.length > 0) findings.push({ code, moduleId: target.moduleId, missingIn });
  }
  return findings.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The key grammar, in full: `errors.<CODE>` and `errors.<CODE>.<token>`.
 *
 * The token shape is issue #65's refusal discriminator — the envelope reads
 * `details.code` and looks up `errors.<CODE>.<token>`, or `errors.<CODE>` when
 * the raise carries no token. **That is a choice between two keys and not a
 * fall-back, and the sentence here said otherwise until D-190.** The envelope
 * composes one key, asks for it once and never re-asks
 * (`localizeErrorEnvelope`, `packages/platform/src/http/error-envelope.ts`), so
 * for an always-tokened code the base key is unreachable — which is exactly the
 * state P1 below reads it in, since `findUntranslatedErrorCodes` asks at
 * `errors.<CODE>` and at no other key. Either way a token key is attributed to
 * its **base** code here. Getting
 * that wrong would report fourteen live sentences in `invoices` and `carts` as
 * naming no code, and the repair a `no-code` finding invites is deletion.
 */
const ERROR_KEY = /^errors\.([A-Z][A-Z0-9_]*)(?:\.([a-z][a-z0-9_]*))?$/;

/**
 * P2 — every written key is a routed key.
 *
 * The comparison is between **directories**, and since Phase 4 that is a plain
 * equality: the walk yields `_i18n` and the routing map says `_i18n`, because a
 * declaration is keyed on a module id. It used to map the table's `core` onto
 * the directory here — one of the three copies of that identity the chain's
 * deletion took with it.
 */
export function findUnreachableSentences(
  input: Pick<TranslationInput, 'keys' | 'readBundle' | 'listBundleKeys'>,
): SentenceFinding[] {
  const findings: SentenceFinding[] = [];
  for (const written of input.listBundleKeys()) {
    const match = ERROR_KEY.exec(written.key);
    if (!match) {
      // Issue #83, slice 1. P5 below still skips the key — it has no code to
      // compare a value against — so this is the one place it is judged, and
      // it is judged here because the question is P2's: is this sentence one
      // anything reads?
      findings.push({
        ...written,
        code: written.key.slice('errors.'.length),
        kind: 'malformed-key',
        routedModuleId: null,
        repair:
          'the envelope reads only errors.<CODE> and errors.<CODE>.<token> (CODE in ' +
          'SCREAMING_SNAKE_CASE, token in snake_case), so nothing renders this key — re-file ' +
          'it under the code it means, or move a sentence the admin reads out of errors.*',
      });
      continue;
    }
    const code = match[1] as string;
    const target = input.keys[code];
    if (!target) {
      findings.push({
        ...written,
        code,
        kind: 'no-code',
        routedModuleId: null,
        repair: `"${code}" is not in ERROR_CODES — delete the key, or re-file it as errors.<CODE>.<token>`,
      });
      continue;
    }
    const routedModuleId = target.moduleId;
    if (routedModuleId === written.moduleId) continue;

    const routedHasIt =
      typeof input.readBundle(target.moduleId, written.language)[written.key] === 'string';
    findings.push({
      ...written,
      code,
      kind: routedHasIt ? 'duplicate' : 'unreachable',
      routedModuleId,
      repair: routedHasIt
        ? `${routedModuleId} holds this key too and is the bundle that is read — delete this copy`
        : `nothing reads this sentence — move it to ${routedModuleId}, or route ${code} here`,
    });
  }
  return findings.sort(
    (a, b) =>
      a.moduleId.localeCompare(b.moduleId) ||
      a.key.localeCompare(b.key) ||
      a.language.localeCompare(b.language),
  );
}

/** Why a written translation is not a sentence in its own language (P5). */
export type PlaceholderFindingKind = 'placeholder' | 'same-as-english';

export interface PlaceholderFinding extends BundleKey {
  /** The base code, with any `.<token>` suffix resolved away. */
  readonly code: string;
  readonly kind: PlaceholderFindingKind;
  /** The value as written, so the report shows what the operator reads. */
  readonly value: string;
  readonly repair: string;
}

/** `X_REFUSED` and `x refused` are one placeholder; so is `too_late` and `too late`. */
function spelledOut(identifier: string): string {
  return identifier.toLowerCase().replace(/_+/g, ' ').trim();
}

/**
 * A one-word label in front of the code — `Błąd: `, `Fehler: ` — which is the
 * whole of what the generator that wrote the placeholders added. One word only,
 * so a real sentence that opens with the word for "error" and goes on in its
 * own language is not mistaken for one.
 */
const PLACEHOLDER_LABEL = /^\p{L}+:\s*/u;

/**
 * Whether `value` is the key's own code written back as text: the code, or the
 * code and its token, lowercased and spelled out, behind at most a one-word
 * label and a full stop. Case-insensitive, so `X Refused.` — the reference
 * language's own title-cased form, copied across — is the same shape.
 */
function isPlaceholder(value: string, code: string, token: string | undefined): boolean {
  const body = value
    .trim()
    .replace(PLACEHOLDER_LABEL, '')
    .replace(/\.$/, '')
    .trim()
    .toLowerCase();
  if (body === spelledOut(code)) return true;
  return token !== undefined && body === spelledOut(`${code}_${token}`);
}

/** `X_REFUSED` and `X Refused`; `too_late` and `Too Late`. Case is significant. */
function titleCased(identifier: string): string {
  return identifier
    .split(/_+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Whether a reference-language `value` is the key's own code written back as
 * text (issue #486): the code, or the code and its token, in Title Case, behind
 * at most a one-word label and a full stop. **Case-sensitive**, unlike
 * `isPlaceholder`: `Order not found.` is an English sentence that spells the
 * same words, and only the Title-Case form is the generator's.
 */
function isReferencePlaceholder(value: string, code: string, token: string | undefined): boolean {
  const body = value.trim().replace(PLACEHOLDER_LABEL, '').replace(/\.$/, '').trim();
  if (body === titleCased(code)) return true;
  return token !== undefined && body === titleCased(`${code}_${token}`);
}

/**
 * A value that is nothing but interpolations — `{reason}` — carries no language,
 * so it is the same string in every bundle by construction and is not a copy.
 */
function carriesNoLanguage(value: string): boolean {
  return !/\p{L}/u.test(value.replace(/\{[^{}]*\}/g, ''));
}

/**
 * P5 — every translation is a sentence in its own language (issue #441).
 *
 * P1 asks whether a string exists under the key and P2 whether it is in the
 * bundle that is read; neither asks what the string says, which is how 137
 * Polish entries of the shape `Błąd: product not found.` passed both. One
 * finding per key, and `placeholder` wins over `same-as-english`: a value that
 * is the code written back is that whatever the reference sentence says. The
 * reference language is judged for `placeholder` only, in its Title-Case shape
 * (issue #486); it has nothing to be a copy of.
 */
export function findPlaceholderSentences(
  input: Pick<TranslationInput, 'readBundle' | 'listBundleKeys'>,
): PlaceholderFinding[] {
  const findings: PlaceholderFinding[] = [];
  for (const written of input.listBundleKeys()) {
    const match = ERROR_KEY.exec(written.key);
    if (!match) continue;
    const value = input.readBundle(written.moduleId, written.language)[written.key];
    if (typeof value !== 'string') continue;
    const code = match[1] as string;
    if (written.language === REFERENCE_LANGUAGE) {
      if (isReferencePlaceholder(value, code, match[2])) {
        findings.push({
          ...written,
          code,
          kind: 'placeholder',
          value,
          repair:
            'this is the code in Title Case, not a sentence — write what the refusal means ' +
            'in sentence case, from the raise site and the other languages\' sentences',
        });
      }
      continue;
    }
    if (isPlaceholder(value, code, match[2])) {
      findings.push({
        ...written,
        code,
        kind: 'placeholder',
        value,
        repair:
          'this is the code written back as text, not a sentence — write what the refusal ' +
          `means in ${written.language}, from the ${REFERENCE_LANGUAGE} sentence and the raise site`,
      });
      continue;
    }
    if (carriesNoLanguage(value)) continue;
    const reference = input.readBundle(written.moduleId, REFERENCE_LANGUAGE)[written.key];
    if (reference === value) {
      findings.push({
        ...written,
        code,
        kind: 'same-as-english',
        value,
        repair: `this is the ${REFERENCE_LANGUAGE} sentence copied across — translate it into ${written.language}`,
      });
    }
  }
  return findings.sort(
    (a, b) =>
      a.moduleId.localeCompare(b.moduleId) ||
      a.key.localeCompare(b.key) ||
      a.language.localeCompare(b.language),
  );
}

// ---------------------------------------------------------------------------
// P6 and P7 — the raise sites (issue #83, slices 2 and 3)
// ---------------------------------------------------------------------------

/** One source file the raise walk opened. */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** A place a code is named, as `<path>:<line>`. */
export interface RaiseSite {
  readonly code: string;
  readonly site: string;
}

/** A `new HttpError(…)` whose `details.code` is a literal token. */
export interface TokenedRaise extends RaiseSite {
  readonly token: string;
}

/**
 * A `new HttpError(…)` whose `details` may carry a token the static read
 * cannot spell — a variable, a parameter, a spread. Not a finding by itself:
 * the token set such a raise draws from is what a manifest's `tokens`
 * declaration states, so the finding is a code raised this way that declares
 * none ({@link findUndeclaredTokenRaises}).
 */
export interface UnresolvedTokenRaise extends RaiseSite {
  readonly expression: string;
}

/** What the raise walk read (P6 and P7). */
export interface RaiseRead {
  /** Source files opened. */
  readonly files: number;
  /**
   * Every place a declared code is **named** in source, by code — a string
   * literal that is exactly the code, or a property access whose name is it
   * (`ERROR_CODES.X`). Comments are not nodes, so they never count.
   */
  readonly references: ReadonlyMap<string, readonly string[]>;
  readonly tokened: readonly TokenedRaise[];
  readonly unresolvedTokens: readonly UnresolvedTokenRaise[];
}

/** Whether `text` contains a word that is one of `codes` — a cheap superset of what the parse finds. */
function spellsAnyOf(text: string, codes: ReadonlySet<string>): boolean {
  for (const [word] of text.matchAll(/[A-Z][A-Z0-9_]*/g)) {
    if (codes.has(word)) return true;
  }
  return false;
}

/** The code a node spells, or `null` — a string literal, or the name of a property access. */
function codeSpelledBy(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

type TokenRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'literal'; readonly tokens: readonly string[] }
  | { readonly kind: 'unresolved'; readonly expression: string };

/** Both of two reads at once — the two branches of a conditional, say. */
function eitherRead(a: TokenRead, b: TokenRead): TokenRead {
  if (a.kind === 'unresolved') return a;
  if (b.kind === 'unresolved') return b;
  if (a.kind === 'none') return b;
  if (b.kind === 'none') return a;
  return { kind: 'literal', tokens: [...a.tokens, ...b.tokens] };
}

/**
 * The initializer of the `const` an identifier names, when the declaration is
 * in a block enclosing the use in the same file — or `null`. A parameter, a
 * `let`, an import and anything declared elsewhere stay unresolved, because
 * the value they hold is not written where the read can see it.
 */
function constInitializer(identifier: ts.Identifier): ts.Expression | null {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    // A parameter of that name shadows every `const` further out.
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === identifier.text)
    ) {
      return null;
    }
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isModuleBlock(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === identifier.text &&
          declaration.initializer !== undefined
        ) {
          return declaration.initializer;
        }
      }
    }
  }
  return null;
}

/** The literal token(s) an expression evaluates to, or why it cannot be read. */
function literalTokens(expression: ts.Expression, source: ts.SourceFile): TokenRead {
  const node = unwrapped(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: 'literal', tokens: [node.text] };
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrue = literalTokens(node.whenTrue, source);
    const whenFalse = literalTokens(node.whenFalse, source);
    if (whenTrue.kind === 'literal' && whenFalse.kind === 'literal') {
      return { kind: 'literal', tokens: [...whenTrue.tokens, ...whenFalse.tokens] };
    }
  }
  return { kind: 'unresolved', expression: node.getText(source) };
}

/**
 * How many `const`s the read follows from one `details` before it gives up —
 * a guard against a declaration that names itself, not a measured depth.
 */
const MAX_CONST_HOPS = 4;

/**
 * The token a raise's `details` argument carries — the same discrimination the
 * envelope's `refusalToken` makes at runtime, made over syntax: the Zod-style
 * array and an absent argument carry none, an object literal carries its
 * `code` member, and anything else is a value the read cannot see into.
 *
 * Four shapes are seen through rather than counted (the ruling of 2026-10-30
 * made every unresolved raise owe a declaration, so a shape the read can
 * decide must not be sent to the manifest): an `.map(…)` call, which is an
 * array; a conditional or a `??`, which is either side; a spread, whose members are
 * read as if written in place; and a `const` declared in an enclosing block of
 * the same file, which is its initializer.
 */
function tokenOfDetails(
  details: ts.Expression | undefined,
  source: ts.SourceFile,
  hops = 0,
): TokenRead {
  if (details === undefined) return { kind: 'none' };
  const node = unwrapped(details);
  if (ts.isIdentifier(node) && node.text === 'undefined') return { kind: 'none' };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'none' };
  if (ts.isArrayLiteralExpression(node)) return { kind: 'none' };
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'map'
  ) {
    return { kind: 'none' };
  }
  if (ts.isConditionalExpression(node)) {
    return eitherRead(
      tokenOfDetails(node.whenTrue, source, hops),
      tokenOfDetails(node.whenFalse, source, hops),
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return eitherRead(
      tokenOfDetails(node.left, source, hops),
      tokenOfDetails(node.right, source, hops),
    );
  }
  if (ts.isIdentifier(node) && hops < MAX_CONST_HOPS) {
    const initializer = constInitializer(node);
    if (initializer !== null) return tokenOfDetails(initializer, source, hops + 1);
  }
  if (!ts.isObjectLiteralExpression(node)) {
    return { kind: 'unresolved', expression: node.getText(source) };
  }
  let read: TokenRead = { kind: 'none' };
  for (const property of node.properties) {
    // Later members win, as they do at runtime, so the walk keeps the last —
    // except that a spread which may or may not carry a `code` keeps the
    // earlier one beside its own.
    if (ts.isSpreadAssignment(property)) {
      const spread = tokenOfDetails(property.expression, source, hops);
      read =
        spread.kind === 'unresolved'
          ? { kind: 'unresolved', expression: property.getText(source) }
          : eitherRead(read, spread);
      continue;
    }
    const name = property.name;
    const named =
      name !== undefined &&
      (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
      name.text === 'code';
    if (!named) continue;
    if (ts.isPropertyAssignment(property)) read = literalTokens(property.initializer, source);
    else read = { kind: 'unresolved', expression: property.getText(source) };
  }
  return read;
}

/**
 * The static read of raise sites (issue #83).
 *
 * Two questions over one parse of every source file:
 *
 * - **Which declared codes are named at all** (P7). A reference is any string
 *   literal that is exactly the code or any property access whose name is it —
 *   deliberately wider than "a raise": a comparison, a mapping table and a
 *   `readonly code = 'X'` field all count. That makes P7's finding an
 *   under-report and never a false one: a code it names is spelled by nothing
 *   the walk opened outside its declaration, so nothing in the tree can raise
 *   it.
 * - **Which tokens each code is raised with** (P6). A raise is
 *   `new HttpError(status, <code>, message, details)` — the platform's one
 *   error constructor — with the code spelled as above, and the token is
 *   `details.code` read the way {@link tokenOfDetails} reads it.
 */
export function readRaiseSites(sources: Iterable<SourceFile>, codes: ReadonlySet<string>): RaiseRead {
  let files = 0;
  const references = new Map<string, string[]>();
  const tokened: TokenedRaise[] = [];
  const unresolvedTokens: UnresolvedTokenRaise[] = [];
  for (const file of sources) {
    files += 1;
    // Both questions need a declared code spelled in the file's text, so a file
    // that spells none cannot answer either and is not parsed. Most of the tree
    // is such a file, and parsing it is most of what a whole-tree read costs.
    if (!spellsAnyOf(file.text, codes)) continue;
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      // Parents, so a `details` identifier can be followed to its `const`.
      true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const siteOf = (node: ts.Node): string =>
      `${file.path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const visit = (node: ts.Node): void => {
      // A vocabulary is a declaration, like a manifest's `errorCodes`: the
      // statement that spells every code once is not a place any of them is
      // raised. `ERROR_CODES` and the per-module `<X>_ERROR_CODES` lists the
      // contracts package publishes beside it are skipped whole; a raise that
      // reads one of them (`ERROR_CODES.X`) is still a reference.
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /^(?:[A-Z][A-Z0-9_]*_)?ERROR_CODES$/.test(node.name.text)
      ) {
        return;
      }
      const spelled = codeSpelledBy(node);
      if (spelled !== null && codes.has(spelled)) {
        const sites = references.get(spelled);
        if (sites) sites.push(siteOf(node));
        else references.set(spelled, [siteOf(node)]);
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'HttpError' &&
        node.arguments !== undefined &&
        node.arguments.length >= 2
      ) {
        const code = codeSpelledBy(unwrapped(node.arguments[1]!));
        if (code !== null && codes.has(code)) {
          const read = tokenOfDetails(node.arguments[3], source);
          const site = siteOf(node);
          if (read.kind === 'literal') {
            for (const token of read.tokens) tokened.push({ code, token, site });
          } else if (read.kind === 'unresolved') {
            unresolvedTokens.push({ code, site, expression: read.expression });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { files, references, tokened, unresolvedTokens };
}

/**
 * Codes the envelope never translates, so a token on them keys no sentence.
 *
 * One member, and it is the envelope's own early return in
 * `localizeErrorEnvelope` (`packages/platform/src/http/error-envelope.ts`):
 * `VALIDATION_FAILED`'s `details.code` values are machine discriminators on the
 * wire, which `_i18n`'s manifest says in terms when it declines to declare
 * them. If the envelope ever translates another code's tokens away, the
 * exclusion is that code too — and nothing else belongs here.
 */
const TOKENS_NEVER_TRANSLATED: ReadonlySet<string> = new Set([ERROR_CODES.VALIDATION_FAILED]);

/** A refusal token with no sentence in a shipped language (P6). */
export interface TokenFinding {
  readonly code: string;
  readonly token: string;
  /** The module whose bundle the envelope reads the token key from. */
  readonly moduleId: string;
  readonly key: string;
  readonly missingIn: readonly string[];
  /** The raise sites that pass the token literally; empty when only the manifest names it. */
  readonly raisedAt: readonly string[];
  /** Whether the declaring manifest names the token in `tokens`. */
  readonly declared: boolean;
}

/**
 * P6 — every token a code is raised with has a sentence in both languages
 * (issue #83, slice 2).
 *
 * The envelope composes **one** key: `errors.<CODE>.<token>` when the raise
 * carries a token and `errors.<CODE>` when it does not, and it never re-asks
 * (D-190). So P1 counting the base key as "translated" says nothing about a
 * tokened raise, whose operator is answered with the thrower's own English —
 * in Polish as well — the moment the token key is absent.
 *
 * The token set is the union of two authors: the literal tokens the raise walk
 * found, and the tokens the declaring manifest names. The second is what covers
 * a raise whose token is a variable (`{ rule, code: rule }`), which the read
 * cannot spell and only counts.
 */
export function findUntranslatedTokens(
  input: Pick<TranslationInput, 'keys' | 'readBundle' | 'declaredTokens'>,
  raises: Pick<RaiseRead, 'tokened'>,
): TokenFinding[] {
  const tokens = new Map<string, Map<string, { raisedAt: string[]; declared: boolean }>>();
  const entry = (code: string, token: string): { raisedAt: string[]; declared: boolean } => {
    let byToken = tokens.get(code);
    if (!byToken) {
      byToken = new Map();
      tokens.set(code, byToken);
    }
    let found = byToken.get(token);
    if (!found) {
      found = { raisedAt: [], declared: false };
      byToken.set(token, found);
    }
    return found;
  };
  for (const [code, declared] of Object.entries(input.declaredTokens)) {
    for (const token of declared) entry(code, token).declared = true;
  }
  for (const raise of raises.tokened) entry(raise.code, raise.token).raisedAt.push(raise.site);

  const findings: TokenFinding[] = [];
  for (const [code, byToken] of tokens) {
    if (TOKENS_NEVER_TRANSLATED.has(code)) continue;
    // A code no module routes is P3's or P4's finding, and the envelope reads
    // no bundle for it at all.
    const target = input.keys[code];
    if (!target) continue;
    for (const [token, found] of byToken) {
      const key = `${target.key}.${token}`;
      const missingIn = LANGUAGES.filter(
        (language) => typeof input.readBundle(target.moduleId, language)[key] !== 'string',
      );
      if (missingIn.length === 0) continue;
      findings.push({
        code,
        token,
        moduleId: target.moduleId,
        key,
        missingIn,
        raisedAt: [...found.raisedAt].sort(),
        declared: found.declared,
      });
    }
  }
  return findings.sort((a, b) => a.code.localeCompare(b.code) || a.token.localeCompare(b.token));
}

/** A code raised with a token the read cannot spell, whose manifest declares none (P6). */
export interface UndeclaredTokenFinding {
  readonly code: string;
  /** The module whose manifest owes the `tokens` declaration. */
  readonly moduleId: string;
  /** The raise sites whose `details.code` is computed. */
  readonly sites: readonly string[];
}

/**
 * P6's `token-undeclared` — a code raised with a computed token declares its
 * token set (issue #83; the maintainer's ruling of 2026-10-30).
 *
 * {@link findUntranslatedTokens} judges the tokens it is given, and for a
 * raise whose `details.code` is a variable, a details object built elsewhere
 * or a spread, the only author of that set is the manifest's `tokens`. A code
 * with no declaration therefore had nothing to be judged against: a token
 * added behind the variable rendered the thrower's English in every language
 * with the check green. So the declaration is required, and once it exists the
 * per-token bundle check covers every member.
 *
 * A declaration of `tokens: []` answers it too — the module's statement that
 * the computed `details` never carries a `code` ({@link declaredTokensOf}).
 *
 * The exclusions are {@link findUntranslatedTokens}' own: a code whose tokens
 * the envelope never translates, and a code no module routes (P3's or P4's
 * finding). Its ledger is {@link UNDECLARABLE_TOKEN_ERROR_CODES}, and it holds
 * only codes whose token set no declaration can state.
 */
export function findUndeclaredTokenRaises(
  input: Pick<TranslationInput, 'keys' | 'declaredTokens'>,
  raises: Pick<RaiseRead, 'unresolvedTokens'>,
): UndeclaredTokenFinding[] {
  const sites = new Map<string, string[]>();
  for (const raise of raises.unresolvedTokens) {
    if (TOKENS_NEVER_TRANSLATED.has(raise.code)) continue;
    if (!input.keys[raise.code]) continue;
    if (raise.code in input.declaredTokens) continue;
    const found = sites.get(raise.code);
    if (found) found.push(raise.site);
    else sites.set(raise.code, [raise.site]);
  }
  return [...sites]
    .map(([code, raisedAt]) => ({
      code,
      moduleId: input.keys[code]!.moduleId,
      sites: [...raisedAt].sort(),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * P7 — a declared code nothing in the tree names (issue #83, slice 3).
 *
 * Over the declared codes, contested ones included: a code two modules declare
 * is P4's finding, and whether anything raises it is a separate question.
 */
export function findUnraisedCodes(
  input: Pick<TranslationInput, 'keys' | 'collisions'>,
  raises: Pick<RaiseRead, 'references'>,
): string[] {
  const declared = new Set([
    ...Object.keys(input.keys),
    ...input.collisions.map((collision) => collision.code),
  ]);
  return [...declared].filter((code) => (raises.references.get(code)?.length ?? 0) === 0).sort();
}

export interface AnalysisResult {
  /** P1 findings, ledgered and not. */
  readonly findings: readonly Finding[];
  readonly unledgered: readonly Finding[];
  readonly stale: readonly string[];
  /** P2 findings — no ledger, so every one of these fails the build. */
  readonly sentences: readonly SentenceFinding[];
  /** P3 findings — the two directions of the enumeration reconciliation. */
  readonly reconciliations: readonly ReconciliationFinding[];
  /** P4 findings — a code more than one registered module declares. */
  readonly collisions: readonly ErrorCodeCollision[];
  /** P5 findings — a translation that is a placeholder or a copy. No ledger. */
  readonly placeholders: readonly PlaceholderFinding[];
  /** What the bundle walk actually read, so a vacuous pass has a name. */
  readonly keysWalked: readonly BundleKey[];
  /** P6 findings — a token a code is raised with that has no sentence. No ledger. */
  readonly tokens: readonly TokenFinding[];
  /** P6's `token-undeclared` findings, ledgered and not. */
  readonly undeclaredTokens: readonly UndeclaredTokenFinding[];
  readonly undeclaredTokensUnledgered: readonly UndeclaredTokenFinding[];
  /** `UNDECLARABLE_TOKEN_ERROR_CODES` entries that are no longer findings. */
  readonly undeclaredTokensStale: readonly string[];
  /** P7 findings — declared codes nothing names, ledgered and not. */
  readonly unraised: readonly string[];
  readonly unraisedUnledgered: readonly string[];
  /** `UNRAISED_ERROR_CODES` entries a raise site now names. */
  readonly unraisedStale: readonly string[];
  /** What the raise walk read (P6, P7), so its vacuous pass has a name too. */
  readonly raises: RaiseRead;
  /**
   * Enumerated codes this run **accounted for** — declared, or reported as
   * `undeclared-enum-member`.
   *
   * The `sources=error-codes:<this>/<enumerated>` half of the read line. It can
   * only fall short of the enumeration if the reconciliation stopped iterating
   * it, which is #215 over this population; an undeclared member is a finding
   * that names the code, never a short walk (see the header).
   */
  readonly enumeratedCodesAccountedFor: number;
  readonly exitCode: 0 | 1 | 2;
  readonly summary: string;
}

/**
 * Every predicate, the ledger arithmetic and the exit code — one function, so
 * the companion test can drive the whole decision from an injected tree instead
 * of re-deriving half of it (issue #130).
 */
export function analyseErrorTranslations(
  input: TranslationInput,
  ledger: ReadonlySet<string> = UNTRANSLATED_ERROR_CODES,
  unraisedLedger: ReadonlySet<string> = UNRAISED_ERROR_CODES,
  undeclarableLedger: ReadonlySet<string> = UNDECLARABLE_TOKEN_ERROR_CODES,
): AnalysisResult {
  const findings = findUntranslatedErrorCodes(input);
  const unledgered = findings.filter((f) => !ledger.has(f.code));
  const found = new Set(findings.map((f) => f.code));
  const stale = [...ledger].filter((code) => !found.has(code)).sort();
  const keysWalked = [...input.listBundleKeys()];
  const sentences = findUnreachableSentences(input);
  const reconciliations = reconcileEnumeration(input);
  const collisions = input.collisions;
  const placeholders = findPlaceholderSentences(input);
  const raises = readRaiseSites(
    input.listSources(),
    new Set([...Object.keys(input.keys), ...input.collisions.map((collision) => collision.code)]),
  );
  const tokens = findUntranslatedTokens(input, raises);
  const undeclaredTokens = findUndeclaredTokenRaises(input, raises);
  const undeclaredTokensUnledgered = undeclaredTokens.filter((f) => !undeclarableLedger.has(f.code));
  const undeclaredFound = new Set(undeclaredTokens.map((f) => f.code));
  const undeclaredTokensStale = [...undeclarableLedger]
    .filter((code) => !undeclaredFound.has(code))
    .sort();
  const unraised = findUnraisedCodes(input, raises);
  const unraisedUnledgered = unraised.filter((code) => !unraisedLedger.has(code));
  const unraisedFound = new Set(unraised);
  const unraisedStale = [...unraisedLedger].filter((code) => !unraisedFound.has(code)).sort();
  const total = Object.keys(input.keys).length;
  const declaredCodes = total + collisions.length;
  // The `sources=error-codes:` half of the read line, as two real counts rather
  // than one number restated: enumerated members the manifests declare, plus
  // enumerated members this run **reported** as undeclared. Their sum is the
  // whole enumeration on any run where the reconciliation went over all of it,
  // and falls short exactly when it did not — which is #215 for this
  // population. An undeclared member is deliberately not a shortfall: it is a
  // finding that names the code (FR-031), and a refusal naming no code sends
  // its reader nowhere.
  const contestedCodes = new Set(collisions.map((collision) => collision.code));
  const declaredEnumMembers = input.enumeratedCodes.filter(
    (code) => code in input.keys || contestedCodes.has(code),
  ).length;
  const enumeratedCodesAccountedFor =
    declaredEnumMembers +
    reconciliations.filter((finding) => finding.kind === 'undeclared-enum-member').length;
  const empty = {
    findings, unledgered, stale, sentences, reconciliations, collisions, placeholders,
    keysWalked, enumeratedCodesAccountedFor, tokens, undeclaredTokens,
    undeclaredTokensUnledgered, undeclaredTokensStale, unraised, unraisedUnledgered,
    unraisedStale, raises,
  };

  // Four vacuity guards, independent on purpose (§2.3). The declarations, the
  // enumeration, the bundles and the sources are four different reads: any one
  // can come back empty while the others are full, and a single guard over one
  // of them lets the others report a clean tree while looking at nothing
  // (issue #113).
  //
  // The first counts a **contested** code as declared. "No manifest declares
  // anything" is the state this guard exists for; a platform whose every
  // declaration collided has declarations, and P4 is what says so.
  if (declaredCodes === 0) {
    return {
      ...empty, exitCode: 2,
      summary:
        '[error-translations] no registered manifest declares an error code — ' +
        'refusing to report a vacuous pass',
    };
  }
  if (input.enumeratedCodes.length === 0) {
    return {
      ...empty, exitCode: 2,
      summary:
        '[error-translations] ERROR_CODES enumerates no code, so the two-way ' +
        'reconciliation compares against nothing — refusing to report a vacuous pass',
    };
  }
  if (keysWalked.length === 0) {
    return {
      ...empty, exitCode: 2,
      summary:
        '[error-translations] the bundle walk read no errors.* key — ' +
        'refusing to report a vacuous pass',
    };
  }
  // The raise walk (issue #83). A walk that opened nothing would report no
  // untranslated token, and one that opened files but named no declared code
  // at all would turn every code into an `unraised` finding — loud, and wrong
  // for the reason the bundle floor's header gives: it sends an author to
  // delete codes that are raised somewhere the walk did not look.
  if (raises.files === 0 || raises.references.size === 0) {
    return {
      ...empty, exitCode: 2,
      summary:
        `[error-translations] the raise walk ${raises.files === 0 ? 'opened no source file' : 'named no declared code in any source file'} — ` +
        'refusing to report a vacuous pass',
    };
  }

  const byKind = (kind: SentenceFindingKind): number =>
    sentences.filter((f) => f.kind === kind).length;
  const byReconciliation = (kind: ReconciliationFindingKind): number =>
    reconciliations.filter((f) => f.kind === kind).length;
  const byPlaceholder = (kind: PlaceholderFindingKind): number =>
    placeholders.filter((f) => f.kind === kind).length;
  return {
    ...empty,
    exitCode:
      unledgered.length > 0 ||
      stale.length > 0 ||
      sentences.length > 0 ||
      reconciliations.length > 0 ||
      collisions.length > 0 ||
      placeholders.length > 0 ||
      tokens.length > 0 ||
      undeclaredTokensUnledgered.length > 0 ||
      undeclaredTokensStale.length > 0 ||
      unraisedUnledgered.length > 0 ||
      unraisedStale.length > 0
        ? 1
        : 0,
    summary:
      `[error-translations] codes=${total} translated=${total - findings.length} ` +
      `violations=${unledgered.length} ledgered=${findings.length - unledgered.length} ` +
      `ledger-size=${ledger.size} stale=${stale.length} ` +
      `written=${keysWalked.length} unreachable=${byKind('unreachable')} ` +
      `duplicate=${byKind('duplicate')} noCode=${byKind('no-code')} ` +
      `malformedKey=${byKind('malformed-key')} ` +
      `undeclaredEnumMember=${byReconciliation('undeclared-enum-member')} ` +
      `undeclaredInEnum=${byReconciliation('undeclared-in-enum')} ` +
      `collision=${collisions.length} ` +
      `placeholder=${byPlaceholder('placeholder')} ` +
      `sameAsEnglish=${byPlaceholder('same-as-english')} ` +
      `tokenUntranslated=${tokens.length} ` +
      `tokenUndeclared=${undeclaredTokensUnledgered.length} ` +
      `tokenUndeclaredLedgered=${undeclaredTokens.length - undeclaredTokensUnledgered.length} ` +
      `tokenUndeclaredStale=${undeclaredTokensStale.length} ` +
      `tokenSitesUnresolved=${raises.unresolvedTokens.length} ` +
      `unraised=${unraisedUnledgered.length} unraisedLedgered=${unraised.length - unraisedUnledgered.length} ` +
      `unraisedLedgerSize=${unraisedLedger.size} unraisedStale=${unraisedStale.length}`,
  };
}

/**
 * Every module bundle the walk opens — this check's real input (issue #244).
 *
 * It never named that input, and `loadBundle` answers `{}` for a file that is
 * not there: a bundle directory that moved turns *every* routed code into a
 * finding, and nothing on the summary line says whether anything was opened at
 * all. Built from the same root and the same path shape as
 * {@link diskBundleKeyWalker}, so the two cannot disagree about where a bundle
 * lives.
 *
 * The paths are absolute and keep their `modules/<id>/` segment, which is what
 * the population floor reads them by.
 */
function bundleFilesOnDisk(directories: ModuleDirectories): string[] {
  return [...directories.values()]
    .flatMap((dir) => LANGUAGES.map((language) => join(dir, 'i18n', `${language}.json`)))
    .filter((path) => existsSync(path));
}

async function main(): Promise<void> {
  // Every module's own directory, derived (feature 080, T040a) — the bundle of
  // a module that has become a package is under the package, not under a root
  // this file could list.
  const layout = await requireModuleLayout('[error-translations]');
  const files = bundleFilesOnDisk(layout.moduleDirectories);

  // The floor, before any finding is printed (issue #215). `refuseVacuous…`
  // loads the index itself, so the pair below is one read done twice rather
  // than two derivations: the ids are needed *here* to compute the exclusion,
  // and the shared guard is the only place the refusal is written.
  let registered: readonly string[];
  let declarations: readonly ManifestErrorCodeDeclaration[];
  try {
    registered = await loadRegisteredModuleIds(layout.manifestIndexPath);
    declarations = await loadManifestErrorCodes(layout.manifestIndexPath);
  } catch (error: unknown) {
    console.error(
      `[error-translations] the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — both the routing map and the bundles it names are derived from ` +
        'it, so there is nothing to compare the walk against; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const sourceRoots = raiseWalkRoots(layout);
  const input = translationInputFor(declarations, layout.moduleDirectories, sourceRoots);
  // The floor's exclusion is "modules that declare no code", so an empty
  // routing map excludes **everything** and switches the floor off — a check
  // reporting on a residue while looking like a normal run. So the declaration
  // guard is asked first and separately, and the analysis asks it again over
  // the same input, which is where a red proof can enter it.
  if (Object.keys(input.keys).length + input.collisions.length === 0) {
    console.error(analyseErrorTranslations(input).summary);
    process.exit(2);
  }
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[error-translations]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    excluded: nonDeclaringModules(input.keys, registered),
    moduleIdOf: layout.moduleIdOfPath,
  });

  // The raise walk's floor (issue #83), the same derivation over the source
  // files: every module that declares a code has to have contributed one, or a
  // module whose sources moved where the walk does not look would turn each of
  // its codes into an `unraised` finding — the residue the bundle floor exists
  // to refuse, one population over.
  const sourceFiles = [...input.listSources()].map((source) => source.path);
  const raiseCoverage = await refuseVacuousModulePopulation({
    prefix: '[error-translations] (raise walk)',
    manifestIndexPath: layout.manifestIndexPath,
    files: sourceFiles,
    excluded: nonDeclaringModules(input.keys, registered),
    moduleIdOf: layout.moduleIdOfPath,
  });

  const result = analyseErrorTranslations(input);
  if (result.exitCode === 2) {
    console.error(result.summary);
    process.exit(2);
  }
  // What was read, beside what was found (issue #244). `files` is both walks'
  // openings — the bundles and the raise walk's sources. `sites` is the union
  // of the predicates' units — the declared codes P1 and P3 judge, the written
  // `errors.*` keys P2 walks, and the places a declared code is named that P6
  // and P7 read — because any of those populations can empty while the others
  // are full, which is the reason the vacuity guards above are independent in
  // the first place. `sources` carries every reconciliation: the two floors
  // this run just enforced (the declaring modules, out of the registered set,
  // against each walk) and the platform's own enumeration against the
  // declarations.
  const referenceSites = [...result.raises.references.values()].reduce(
    (sum, sites) => sum + sites.length,
    0,
  );
  reportReadSize({
    prefix: '[error-translations]',
    files: files.length + result.raises.files,
    sites: Object.keys(input.keys).length + result.keysWalked.length + referenceSites,
    coverage: [
      coverage,
      { source: 'raise-walk', expected: raiseCoverage.expected, covered: raiseCoverage.covered },
      {
        source: 'error-codes',
        expected: input.enumeratedCodes.length,
        covered: result.enumeratedCodesAccountedFor,
      },
    ],
  });
  console.log(result.summary);

  if (result.unledgered.length > 0) {
    console.error(
      '\nThese error codes render as a raw code to the operator. Add ' +
        '"errors.<CODE>" to the owning module\'s i18n bundle, in BOTH languages:',
    );
    for (const f of result.unledgered) {
      console.error(`  - ${f.code} → ${f.moduleId} (missing in: ${f.missingIn.join(', ')})`);
    }
  }

  if (result.stale.length > 0) {
    console.error(
      '\nThese are in UNTRANSLATED_ERROR_CODES but now have a sentence. Delete ' +
        'them from the ledger — it may only shrink:',
    );
    for (const code of result.stale) console.error(`  - ${code}`);
  }

  if (result.sentences.length > 0) {
    console.error(
      '\nThese sentences are written where the routing map does not look, or under a ' +
        'key the envelope cannot compose, so nothing reads them. There is no ledger for ' +
        'this — every repair is a ' +
        'JSON line moved or deleted, plus at most one declaration line:',
    );
    for (const f of result.sentences) {
      const routed = f.routedModuleId ?? 'nothing';
      console.error(
        `  - [${f.kind}] ${f.moduleId}/i18n/${f.language}.json "${f.key}" ` +
          `(routed: ${routed}) — ${f.repair}`,
      );
    }
  }

  if (result.reconciliations.length > 0) {
    console.error(
      '\nERROR_CODES and the modules\' declarations disagree. The prefix chain used to ' +
        'absorb this by answering `core` for anything it had no rule for; there is no ' +
        'fall-through any more, so a code on either side of this list routes nowhere ' +
        '(FR-031). There is no ledger — every repair is one line in a manifest:',
    );
    for (const f of result.reconciliations) {
      console.error(`  - [${f.kind}] ${f.code} — ${f.repair}`);
    }
  }

  if (result.collisions.length > 0) {
    console.error(
      '\nTwo modules this repository ships claim the same error code. At runtime it ' +
        "would route to neither and the operator would read the raising code's own " +
        'English. One of them has to give the code up — the domain noun decides, not ' +
        'the thrower (specs/082-error-code-ownership/):\n' +
        describeErrorCodeCollisions(result.collisions),
    );
  }

  if (result.placeholders.length > 0) {
    console.error(
      '\nThese error messages are not sentences in their own language: the code written ' +
        'back as text, or the English sentence copied across. Every check above counts ' +
        'them as translated, and an operator reads them verbatim. There is no ledger — ' +
        'every repair is one sentence written:',
    );
    for (const f of result.placeholders) {
      console.error(
        `  - [${f.kind}] ${f.moduleId}/i18n/${f.language}.json "${f.key}": ` +
          `${JSON.stringify(f.value)} — ${f.repair}`,
      );
    }
  }

  if (result.tokens.length > 0) {
    console.error(
      '\nThese refusal tokens have no sentence. The envelope looks up ' +
        'errors.<CODE>.<token> for a raise that carries one and never falls back to ' +
        'errors.<CODE>, so the operator reads the thrower\'s own English in every ' +
        'language. There is no ledger — every repair is a sentence written in both bundles:',
    );
    for (const f of result.tokens) {
      const where =
        f.raisedAt.length > 0 ? `raised at ${f.raisedAt.join(', ')}` : 'declared in the manifest only';
      console.error(
        `  - ${f.key} → ${f.moduleId} (missing in: ${f.missingIn.join(', ')}; ${where})`,
      );
    }
  }

  if (result.undeclaredTokensUnledgered.length > 0) {
    console.error(
      '\nThese codes are raised with a refusal token the static read cannot spell, and ' +
        'their manifest declares no `tokens`, so no sentence can be checked for what the ' +
        'raise will carry. Follow the variable to the values it can take and declare them ' +
        'in errorCodes[].tokens (tokens: [] when none of them carries a code); the token ' +
        'check above then asks for each sentence. Do not add to UNDECLARABLE_TOKEN_ERROR_CODES ' +
        'to make a build pass — that ledger ' +
        'holds only codes whose token set cannot be declared, and their repair is at the raise:',
    );
    for (const f of result.undeclaredTokensUnledgered) {
      console.error(`  - [token-undeclared] ${f.code} → ${f.moduleId} (raised at ${f.sites.join(', ')})`);
    }
  }

  if (result.undeclaredTokensStale.length > 0) {
    console.error(
      '\nThese are in UNDECLARABLE_TOKEN_ERROR_CODES but are no longer raised with an ' +
        'undeclared computed token. Delete them from the ledger — it may only shrink:',
    );
    for (const code of result.undeclaredTokensStale) console.error(`  - ${code}`);
  }

  if (result.unraisedUnledgered.length > 0) {
    console.error(
      '\nThese codes are declared and nothing in the source tree names them — no raise ' +
        'site, no comparison, no mapping. Raise the code where its condition is ' +
        'detected, or drop the declaration (and its ERROR_CODES member and sentences). ' +
        'Do not add it to UNRAISED_ERROR_CODES to make a build pass:',
    );
    for (const code of result.unraisedUnledgered) console.error(`  - ${code}`);
  }

  if (result.unraisedStale.length > 0) {
    console.error(
      '\nThese are in UNRAISED_ERROR_CODES but the source tree now names them. Delete ' +
        'them from the ledger — it may only shrink:',
    );
    for (const code of result.unraisedStale) console.error(`  - ${code}`);
  }

  if (result.exitCode !== 0) process.exit(result.exitCode);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit. Compared as a URL, like every other check:
// the previous `endsWith(basename)` test answers true for an argv[1] ending in
// a slash, which would have run the whole check on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
