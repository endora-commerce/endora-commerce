/**
 * Every error code an operator can see has a sentence, in both shipped
 * languages — and every sentence written anywhere is one an operator can reach.
 *
 * Two predicates over one population, and they are two halves of a bijection
 * (feature 082, D-127):
 *
 *   **P1** every routed key exists. For each code in `ERROR_TRANSLATION_KEYS`,
 *          the bundle it routes to has `errors.<CODE>` in `en` and `pl`.
 *          Ledgered by `UNTRANSLATED_ERROR_CODES`, two-way, may only shrink.
 *   **P2** every written key is a routed key. For each `errors.*` key in any
 *          module bundle, the module holding it is the module the routing table
 *          points at. Three kinds — `unreachable`, `duplicate`, `no-code` — and
 *          **no ledger**, deliberately: every repair is a JSON line moved or
 *          deleted plus at most one routing line, so there is nothing to
 *          schedule. Four candidate exceptions were tested and refuted
 *          (`specs/082-error-code-ownership/rulings.md` § 7). If a fifth is
 *          found, record it there and add the ledger then — do not ship an
 *          empty one.
 *
 * P1 alone cannot see a sentence written in a bundle the table does not name,
 * and that is where issue #229's five defects lived: `carts` had finished
 * wording for two codes routed to `core`, and three more codes were shadowed by
 * a machine-shaped placeholder in the bundle routing did reach — in Polish,
 * `Błąd: order not found.` standing over `Nie znaleziono zamówienia.`
 *
 * The envelope's `preSerialization` hook replaces an error's message wholesale
 * with the bundle string for `errors.<CODE>`, resolved in the module
 * `ERROR_TRANSLATION_KEYS` routes the code to. When that key is absent the
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
 * So the walk is reconciled against a population **two static imports** derive
 * and the filesystem does not: the module ids the generated manifest index
 * registers, intersected with the module directories `ERROR_TRANSLATION_KEYS`
 * routes a code to. Every one of those must contribute a bundle file, or the
 * run exits 2 rather than reporting on a residue. A registered module the
 * routing table does **not** name is outside the floor by design — nothing
 * requires a module to ship an i18n bundle at all, and 45 of the 66 registered
 * modules ship one — which is the claim {@link unroutedModules} makes and the
 * only exclusion the floor takes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
import {
  loadRegisteredModuleIds,
  refuseVacuousModulePopulation,
} from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { requireModuleLayout, resolveModuleLayout } from './lib/module-roots.js';

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
 * `ERROR_TRANSLATION_KEYS` names the owning module; `core` is not a directory.
 * The platform-wide bundle is `_i18n`'s own.
 */
const CORE_BUNDLE_MODULE = '_i18n';

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
 * **Read the `core` block as "unrouted", not "owned by the kernel."** Sixty-one
 * of these reach `core` by falling off the end of `moduleIdForErrorCode`, which
 * matches on code prefixes and has no rule for them — `KSEF_*` and
 * `PIM_ERGONODE_*` plainly belong to their modules. So draining a block usually
 * means two edits: a routing rule, and the sentences in the module's own bundle.
 * The routing gap is the reason the sentences went missing unnoticed, because a
 * code routed to `core` looks like somebody else's problem.
 *
 * `MFA_*` is the worked example, and it took both edits and two issues: #194
 * added the routing rule, #223 the nine sentences in `mfa`'s own bundle. In
 * between, the family was routed correctly and still untranslated, and this
 * ledger read exactly as it had before — which is the thing to notice. Nothing
 * *in this list* distinguishes "no sentence written yet" from "no sentence could
 * ever have been found", so a code listed under `core` says nothing about
 * whether its bundle is reachable at all.
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
  // core (59)
  'ACCOUNT_BLOCKED', 'API_KEY_CHANNEL_MISMATCH', 'API_KEY_NOT_BOUND',
  'ASSISTANT_DISABLED', 'ASSISTANT_NOT_CONFIGURED', 'BULK_TOO_LARGE',
  'CUSTOMER_ADDRESS_NOT_FOUND',
  'CUSTOMER_ALREADY_DELETED', 'CUSTOMER_NOT_DELETED', 'CUSTOMER_NOT_FOUND',
  'CUSTOMER_RESTORE_WINDOW_ELAPSED', 'CUSTOM_FIELD_DEFINITION_INVALID', 'CUSTOM_FIELD_HOST_MANAGED',
  'CUSTOM_FIELD_KEY_CONFLICT', 'CUSTOM_FIELD_NOT_FOUND', 'CUSTOM_FIELD_VALUE_INVALID',
  'IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'KSEF_ALREADY_SUBMITTED',
  'KSEF_CREDENTIAL_EXISTS', 'KSEF_CREDENTIAL_INVALID', 'KSEF_ENROLLMENT_REJECTED',
  'KSEF_NOT_CONFIGURED', 'KSEF_NOT_SUBMITTABLE', 'KSEF_UNAVAILABLE',
  'MODULE_ACTIVATION_PROTECTED', 'MODULE_DEPENDENCIES_ABSENT', 'MODULE_DEPENDENTS_PRESENT',
  'MODULE_NOT_DEACTIVATABLE', 'MODULE_NOT_FOUND', 'MODULE_SETTING_READ_ONLY',
  'ORG_OWNER_DEPLETION', 'PACKAGING_UNIT_NAME_CONFLICT', 'PACKAGING_UNIT_NOT_FOUND',
  'PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE', 'PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE', 'PIM_ERGONODE_BINDING_EXISTS',
  'PIM_ERGONODE_CONNECTION_DISABLED', 'PIM_ERGONODE_CONNECTION_EXISTS', 'PIM_ERGONODE_CURRENCY_INACTIVE',
  'PIM_ERGONODE_FIELD_PATH_INVALID', 'PIM_ERGONODE_IMPORT_ALREADY_RUNNING', 'PIM_ERGONODE_NOT_CONFIGURED',
  'PIM_ERGONODE_SCHEDULE_INVALID', 'PIM_ERGONODE_TARGET_ALREADY_MAPPED', 'PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND',
  'PIM_ERGONODE_TREE_REQUIRED', 'PIM_ERGONODE_TYPE_INCOMPATIBLE', 'PRICE_LIST_NOT_FOUND',
  'PRICE_UNAVAILABLE', 'PROMPT_PERMISSION_REVOKED', 'PROMPT_PLAN_EXPIRED',
  'PROMPT_REQUEST_INVALID_STATE', 'PROMPT_REQUEST_IN_FLIGHT', 'REGISTRATION_REQUIRES_ORGANIZATION',
  'SELECTION_TOO_LARGE', 'SHOPPING_LIST_CANNOT_DELETE_DEFAULT', 'SHOPPING_LIST_CANNOT_DELETE_LAST',
  'TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE',
  // catalog (7)
  'ATTRIBUTE_NOT_MASS_EDITABLE', 'PRODUCT_FEED_CONFIRMATION_REQUIRED', 'PRODUCT_FEED_DISABLED',
  'PRODUCT_FEED_TAXONOMY_CONFLICT', 'PRODUCT_FEED_TEMPLATE_CONFLICT', 'PRODUCT_FEED_TEMPLATE_UNBOUND',
  'SKU_NOT_IN_ASSORTMENT',
  // settings (1)
  'SETTING_SECRET_KEY_MISSING',
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
 * routing table the tree does not contain. Defaults are the real ones, so the
 * CLI and the test share one implementation.
 */
export interface TranslationInput {
  readonly keys: Readonly<Record<string, ErrorTranslationTarget>>;
  /** P1: the bundle for `moduleId` in `language`, as a flat key → value map. */
  readonly readBundle: (moduleId: string, language: string) => Record<string, unknown>;
  /**
   * P2: every `errors.*` key written anywhere, with the bundle that holds it.
   *
   * A separate member because `readBundle(moduleId, language)` can only read the
   * bundle the routing table names, and P2's whole question is about the bundles
   * it does not name. `moduleId` here is the **directory** — `_i18n`, never
   * `core`; the rename is applied to the table's answer, which is the only place
   * it means anything.
   */
  readonly listBundleKeys: () => Iterable<BundleKey>;
}

/** One `errors.*` key as it is written on disk. */
export interface BundleKey {
  readonly moduleId: string;
  readonly language: string;
  readonly key: string;
}

/** Why a written sentence is not the sentence anything reads. */
export type SentenceFindingKind = 'unreachable' | 'duplicate' | 'no-code';

export interface SentenceFinding extends BundleKey {
  /** The base code, with any `.<token>` suffix resolved away. */
  readonly code: string;
  readonly kind: SentenceFindingKind;
  /** The directory the routing table points at, or `null` for `no-code`. */
  readonly routedModuleId: string | null;
  readonly repair: string;
}

/**
 * The module **directories** the routing table names — `core` resolved to the
 * bundle that actually holds it.
 *
 * These are the bundles P1 reads, so they are the ones a run has to have
 * opened. Derived on every run from the table itself, never written down: a
 * module that stops routing a code leaves this set in the same run (D-100).
 */
export function routedBundleDirectories(
  keys: Readonly<Record<string, ErrorTranslationTarget>> = ERROR_TRANSLATION_KEYS,
): string[] {
  const directories = new Set(
    Object.values(keys).map((target) =>
      target.moduleId === 'core' ? CORE_BUNDLE_MODULE : target.moduleId,
    ),
  );
  return [...directories].sort();
}

/**
 * Registered modules the population floor does not ask for — the complement of
 * {@link routedBundleDirectories} inside the registered set.
 *
 * This is the check's one exclusion claim, and it is a claim rather than a
 * convenience: a module that routes no error code is not required to ship an
 * i18n bundle, and most do not carry an `errors.*` key even when they ship one.
 * Asking every registered module for a bundle would make the floor a list of
 * twenty exceptions, which is a floor nobody can read.
 */
export function unroutedModules(
  keys: Readonly<Record<string, ErrorTranslationTarget>>,
  registered: readonly string[],
): string[] {
  const routed = new Set(routedBundleDirectories(keys));
  return registered.filter((id) => !routed.has(id));
}

function bundlePath(
  directories: ModuleDirectories,
  moduleId: string,
  language: string,
): string | null {
  const dir = directories.get(moduleId === 'core' ? CORE_BUNDLE_MODULE : moduleId);
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
 * The tree's own input, over the layout's module directories.
 *
 * Async since feature 080's T040a, because "where does module `x` keep its
 * bundle" is now a question about the workspace rather than about one path.
 * Every caller that means *this repository* — the CLI and the tree tests —
 * goes through it, so there is one derivation and not a default beside it.
 */
export async function treeTranslationInput(): Promise<TranslationInput> {
  const layout = await resolveModuleLayout();
  return translationInputFor(layout.moduleDirectories);
}

/** The same input over a given set of module directories. */
export function translationInputFor(directories: ModuleDirectories): TranslationInput {
  return {
    keys: ERROR_TRANSLATION_KEYS,
    readBundle: diskBundleReader(directories),
    listBundleKeys: diskBundleKeyWalker(directories),
  };
}

export function findUntranslatedErrorCodes(input: TranslationInput): Finding[] {
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
 * `details.code`, looks up `errors.<CODE>.<token>` and falls back to
 * `errors.<CODE>` — so a token key is attributed to its **base** code. Getting
 * that wrong would report fourteen live sentences in `invoices` and `carts` as
 * naming no code, and the repair a `no-code` finding invites is deletion.
 */
const ERROR_KEY = /^errors\.([A-Z][A-Z0-9_]*)(?:\.([a-z][a-z0-9_]*))?$/;

/**
 * P2 — every written key is a routed key.
 *
 * The comparison is between **directories**: the walk yields `_i18n`, and the
 * routing table's `core` is mapped onto it here rather than in the walk, because
 * `core` is a routing answer and never a place on disk.
 */
export function findUnreachableSentences(input: TranslationInput): SentenceFinding[] {
  const findings: SentenceFinding[] = [];
  for (const written of input.listBundleKeys()) {
    const match = ERROR_KEY.exec(written.key);
    if (!match) continue;
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
    const routedModuleId = target.moduleId === 'core' ? CORE_BUNDLE_MODULE : target.moduleId;
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

export interface AnalysisResult {
  /** P1 findings, ledgered and not. */
  readonly findings: readonly Finding[];
  readonly unledgered: readonly Finding[];
  readonly stale: readonly string[];
  /** P2 findings — no ledger, so every one of these fails the build. */
  readonly sentences: readonly SentenceFinding[];
  /** What the bundle walk actually read, so a vacuous pass has a name. */
  readonly keysWalked: readonly BundleKey[];
  readonly exitCode: 0 | 1 | 2;
  readonly summary: string;
}

/**
 * Both predicates, the ledger arithmetic and the exit code — one function, so
 * the companion test can drive the whole decision from an injected tree instead
 * of re-deriving half of it (issue #130).
 */
export function analyseErrorTranslations(
  input: TranslationInput,
  ledger: ReadonlySet<string> = UNTRANSLATED_ERROR_CODES,
): AnalysisResult {
  const findings = findUntranslatedErrorCodes(input);
  const unledgered = findings.filter((f) => !ledger.has(f.code));
  const found = new Set(findings.map((f) => f.code));
  const stale = [...ledger].filter((code) => !found.has(code)).sort();
  const keysWalked = [...input.listBundleKeys()];
  const sentences = findUnreachableSentences(input);
  const total = Object.keys(input.keys).length;

  // Two vacuity guards, independent on purpose (§ 3.3). The routing table is a
  // static import and the bundles are a filesystem walk, so either can come
  // back empty while the other is full; a single guard over one of them lets
  // the other report a clean tree while looking at nothing (issue #113).
  if (total === 0) {
    return {
      findings, unledgered, stale, sentences, keysWalked, exitCode: 2,
      summary:
        '[error-translations] ERROR_TRANSLATION_KEYS routes no code — ' +
        'refusing to report a vacuous pass',
    };
  }
  if (keysWalked.length === 0) {
    return {
      findings, unledgered, stale, sentences, keysWalked, exitCode: 2,
      summary:
        '[error-translations] the bundle walk read no errors.* key — ' +
        'refusing to report a vacuous pass',
    };
  }

  const byKind = (kind: SentenceFindingKind): number =>
    sentences.filter((f) => f.kind === kind).length;
  return {
    findings,
    unledgered,
    stale,
    sentences,
    keysWalked,
    exitCode: unledgered.length > 0 || stale.length > 0 || sentences.length > 0 ? 1 : 0,
    summary:
      `[error-translations] codes=${total} translated=${total - findings.length} ` +
      `violations=${unledgered.length} ledgered=${findings.length - unledgered.length} ` +
      `ledger-size=${ledger.size} stale=${stale.length} ` +
      `written=${keysWalked.length} unreachable=${byKind('unreachable')} ` +
      `duplicate=${byKind('duplicate')} noCode=${byKind('no-code')}`,
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
  try {
    registered = await loadRegisteredModuleIds(layout.manifestIndexPath);
  } catch (error: unknown) {
    console.error(
      `[error-translations] the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the routed bundles are derived from it, so there is nothing ` +
        'to compare the walk against; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[error-translations]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    excluded: unroutedModules(ERROR_TRANSLATION_KEYS, registered),
    moduleIdOf: layout.moduleIdOfPath,
  });

  const result = analyseErrorTranslations(translationInputFor(layout.moduleDirectories));
  if (result.exitCode === 2) {
    console.error(result.summary);
    process.exit(2);
  }
  // What was read, beside what was found (issue #244). `sites` is the union of
  // the two predicates' units — the routed codes P1 judges and the written
  // `errors.*` keys P2 walks — because either population can empty while the
  // other is full, which is the reason the two vacuity guards above are
  // independent in the first place. `sources` is the reconciliation the floor
  // just enforced: the routed modules, out of the registered set.
  reportReadSize({
    prefix: '[error-translations]',
    files: files.length,
    sites: Object.keys(ERROR_TRANSLATION_KEYS).length + result.keysWalked.length,
    coverage: [coverage],
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
      '\nThese sentences are written where the routing table does not look, so ' +
        'nothing reads them. There is no ledger for this — every repair is a ' +
        'JSON line moved or deleted, plus at most one routing line:',
    );
    for (const f of result.sentences) {
      const routed = f.routedModuleId ?? 'nothing';
      console.error(
        `  - [${f.kind}] ${f.moduleId}/i18n/${f.language}.json "${f.key}" ` +
          `(routed: ${routed}) — ${f.repair}`,
      );
    }
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
