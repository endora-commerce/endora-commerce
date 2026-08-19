/**
 * Every error code an operator can see has a sentence, in both shipped
 * languages.
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
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ERROR_TRANSLATION_KEYS } from '../src/modules/_i18n/services/error-translation.js';

const here = dirname(fileURLToPath(import.meta.url));
const modulesRoot = resolve(here, '../src/modules');

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
 * machine-shaped strings is what produced the 181 Polish placeholders already in
 * the tree (`Błąd: <the english code, lowercased>`). Those satisfy a checker and
 * help nobody, which is the outcome this ledger exists to avoid repeating.
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
 * here distinguishes "no sentence written yet" from "no sentence could ever have
 * been found", so a code listed under `core` says nothing about whether its
 * bundle is reachable at all.
 *
 * Two entries below are already the second kind, measured while draining
 * `MFA_*`: `CART_COUPON_REJECTED` and `CART_LINE_CAP_EXCEEDED` have finished
 * sentences in both languages in `carts`' own bundle, and route to `core`, which
 * has neither — so "untranslated" is the wrong word for them, and moving them
 * out of this list means a routing decision rather than a piece of writing.
 *
 * Grouped as measured, so a module can drain its own block.
 */
export const UNTRANSLATED_ERROR_CODES: ReadonlySet<string> = new Set([
  // core (61)
  'ACCOUNT_BLOCKED', 'API_KEY_CHANNEL_MISMATCH', 'API_KEY_NOT_BOUND',
  'ASSISTANT_DISABLED', 'ASSISTANT_NOT_CONFIGURED', 'BULK_TOO_LARGE',
  'CART_COUPON_REJECTED', 'CART_LINE_CAP_EXCEEDED', 'CUSTOMER_ADDRESS_NOT_FOUND',
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
  /** The bundle for `moduleId` in `language`, as a flat key → value map. */
  readonly readBundle: (moduleId: string, language: string) => Record<string, unknown>;
}

function bundlePath(moduleId: string, language: string): string {
  const dir = moduleId === 'core' ? CORE_BUNDLE_MODULE : moduleId;
  return join(modulesRoot, dir, 'i18n', `${language}.json`);
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

/** Reads a module's on-disk bundle, memoised — the default {@link TranslationInput}. */
export function diskBundleReader(): TranslationInput['readBundle'] {
  const cache = new Map<string, Record<string, unknown>>();
  return (moduleId: string, language: string): Record<string, unknown> => {
    const path = bundlePath(moduleId, language);
    let bundle = cache.get(path);
    if (!bundle) {
      bundle = loadBundle(path);
      cache.set(path, bundle);
    }
    return bundle;
  };
}

export function findUntranslatedErrorCodes(
  input: TranslationInput = { keys: ERROR_TRANSLATION_KEYS, readBundle: diskBundleReader() },
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

function main(): void {
  const findings = findUntranslatedErrorCodes();
  const unledgered = findings.filter((f) => !UNTRANSLATED_ERROR_CODES.has(f.code));
  const found = new Set(findings.map((f) => f.code));
  const stale = [...UNTRANSLATED_ERROR_CODES].filter((code) => !found.has(code)).sort();

  const total = Object.keys(ERROR_TRANSLATION_KEYS).length;
  if (total === 0) {
    // The routing table is the whole input. An empty one reports every code
    // translated, which is the same green as every code having a sentence.
    console.error(
      '[error-translations] ERROR_TRANSLATION_KEYS routes no code — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  console.log(
    `[error-translations] codes=${total} translated=${total - findings.length} ` +
      `violations=${unledgered.length} ledgered=${findings.length - unledgered.length} ` +
      `ledger-size=${UNTRANSLATED_ERROR_CODES.size} stale=${stale.length}`,
  );

  if (unledgered.length > 0) {
    console.error(
      '\nThese error codes render as a raw code to the operator. Add ' +
        '"errors.<CODE>" to the owning module\'s i18n bundle, in BOTH languages:',
    );
    for (const f of unledgered) {
      console.error(`  - ${f.code} → ${f.moduleId} (missing in: ${f.missingIn.join(', ')})`);
    }
  }

  if (stale.length > 0) {
    console.error(
      '\nThese are in UNTRANSLATED_ERROR_CODES but now have a sentence. Delete ' +
        'them from the ledger — it may only shrink:',
    );
    for (const code of stale) console.error(`  - ${code}`);
  }

  if (unledgered.length > 0 || stale.length > 0) process.exit(1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit. Compared as a URL, like every other check:
// the previous `endsWith(basename)` test answers true for an argv[1] ending in
// a slash, which would have run the whole check on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
