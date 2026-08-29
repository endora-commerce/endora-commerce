import { ERROR_CODES, type ErrorCode } from '@endora-commerce/contracts';

export interface ErrorTranslationTarget {
  moduleId: string;
  /**
   * Widened from `errors.${ErrorCode}` by feature 090: a module declares codes
   * the platform's enumeration does not hold, and the key is built from the
   * code either way.
   */
  key: `errors.${string}`;
}

const GENERIC_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.VERSION_CONFLICT,
  ERROR_CODES.VALIDATION_FAILED,
  ERROR_CODES.INTERNAL,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.UNAUTHORIZED,
  ERROR_CODES.FORBIDDEN,
  ERROR_CODES.RATE_LIMITED,
]);

const CATALOG_MISC_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.FILTER_NOT_ALLOWED,
  ERROR_CODES.FIELD_IMMUTABLE,
  ERROR_CODES.ASSET_KIND_NOT_SUPPORTED,
  ERROR_CODES.NESTED_COMPOSITE_NOT_ALLOWED,
  ERROR_CODES.INVALID_QUANTITY_RANGE,
  ERROR_CODES.OPTION_ALREADY_EXISTS,
  ERROR_CODES.MIN_NOT_MET,
  ERROR_CODES.MAX_EXCEEDED,
  ERROR_CODES.UNKNOWN_OPTION,
  // Feature 086 — named one by one rather than by a `PRICE_` prefix, which
  // would take the whole `PRICE_LIST_*` family off `price_lists`. Routed to
  // `catalog` because that is the module whose route refuses: the price is not
  // an attribute and neither code is a price-list error.
  ERROR_CODES.PRICE_ORDERING_UNAVAILABLE,
  ERROR_CODES.PRICE_RANGE_INVALID,
]);

const SEARCH_MISC_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.LIMIT_OUT_OF_RANGE,
  ERROR_CODES.RESULT_COUNT_INVALID,
  ERROR_CODES.LLM_CONFIG_INCOMPLETE,
]);

const SALES_CHANNEL_MISC_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.INACTIVE_SALES_CHANNEL,
  ERROR_CODES.MISSING_SALES_CHANNEL_CONTEXT,
  ERROR_CODES.DUPLICATE_SALES_CHANNEL_CODE,
  ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
  ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS,
  ERROR_CODES.STALE_SALES_CHANNEL_WRITE,
]);

const INVENTORY_MISC_ERROR_CODES = new Set<ErrorCode>([
  ERROR_CODES.PRODUCT_UNMANAGED_STOCK,
  ERROR_CODES.AVAILABILITY_NOTIFICATION_NOT_FOUND,
  ERROR_CODES.PRODUCT_IN_STOCK,
]);

export const ERROR_TRANSLATION_KEYS = Object.fromEntries(
  Object.values(ERROR_CODES).map((code): [ErrorCode, ErrorTranslationTarget] => [
    code,
    {
      moduleId: moduleIdForErrorCode(code),
      key: `errors.${code}`,
    },
  ]),
) as Record<ErrorCode, ErrorTranslationTarget>;

function moduleIdForErrorCode(code: ErrorCode): string {
  if (code.startsWith('SETTING_')) return 'settings';
  if (GENERIC_ERROR_CODES.has(code)) {
    return 'core';
  }
  if (
    code.startsWith('PRODUCT_') ||
    code.startsWith('SKU_') ||
    code.startsWith('VARIANT_') ||
    code.startsWith('ATTRIBUTE_') ||
    code.startsWith('GALLERY_') ||
    code.startsWith('ATTACHMENT_') ||
    code.startsWith('SELF_LINK_') ||
    code.startsWith('LINK_') ||
    code.startsWith('TARGET_PRODUCT_') ||
    code.startsWith('BUNDLE_') ||
    code.startsWith('GROUPED_') ||
    CATALOG_MISC_ERROR_CODES.has(code)
  ) {
    return 'catalog';
  }
  if (code.startsWith('RFQ_') || code.startsWith('QUOTE_')) return 'quote_requests';
  if (
    code.startsWith('QUERY_') ||
    code.startsWith('SEARCH_') ||
    code.startsWith('PHRASE_') ||
    SEARCH_MISC_ERROR_CODES.has(code)
  ) {
    return 'search';
  }
  if (
    code.startsWith('UNKNOWN_') ||
    code.startsWith('SALES_CHANNEL_') ||
    SALES_CHANNEL_MISC_ERROR_CODES.has(code)
  ) {
    return 'sales_channels';
  }
  if (code.startsWith('COMPARISON_') || code === ERROR_CODES.PDF_GENERATION_FAILED) return 'comparisons';
  if (
    code.startsWith('WAREHOUSE_') ||
    code.startsWith('CHANNEL_') ||
    code.startsWith('STOCK_') ||
    code.startsWith('THRESHOLDS_') ||
    INVENTORY_MISC_ERROR_CODES.has(code)
  ) {
    return 'inventory';
  }
  // Feature 078, D-95.2 — routing is by **semantic owner**, not by thrower:
  // `INVOICE_NUMBER_PATTERN_COLLIDES` is thrown inside `settings`' write path
  // and `INVOICE_NOT_READY` inside `orders`' download route, exactly as
  // `PRODUCT_*` codes are thrown from modules other than `catalog`. `_i18n`
  // loads every registered module's bundle regardless of activation, so a
  // switched-off `invoices` does not cost another module its sentence. Keeping
  // the family in one bundle is how the next sentence stops going missing.
  if (code.startsWith('INVOICE_')) return 'invoices';
  // Issue #231 — the `CART_*` family is exactly three codes (`CART_EMPTY`,
  // `CART_LINE_CAP_EXCEEDED`, `CART_COUPON_REJECTED`) and `carts` holds a
  // written sentence for all three in both languages, while `_i18n` held one
  // for `CART_EMPTY` alone — so the other two rendered as a raw code to the
  // buyer, and `CART_COUPON_REJECTED`'s seven refusal tokens could not be
  // reached at all. Same rule as `INVOICE_*` above: the bundle follows the
  // domain noun, not the thrower, even though `orders` throws `CART_EMPTY` at
  // checkout. `_i18n`'s stranded `CART_EMPTY` pair is deleted with this line;
  // routing only the two unreachable codes would split a three-member family
  // across two bundles, which is the arrangement that hid this.
  if (code.startsWith('CART_')) return 'carts';
  // Feature 082, D-125 — the `ORDER_*` family is exactly two codes
  // (`ORDER_NOT_FOUND`, `ORDER_NOT_CANCELLABLE`). T1 of D-121 answers directly:
  // the noun is an order and `orders` owns orders, so the sentence leaves
  // `invoices` — which throws the code once and wrote the only real sentence
  // for it — exactly as D-95.2 sent `INVOICE_NOT_READY` the other way from
  // `orders` to `invoices`. Unlike `CART_*` this family has a member that the
  // move would strand: `ORDER_NOT_CANCELLABLE` had only `_i18n`'s placeholder,
  // so `orders` gains a written sentence for it in the same change rather than
  // a ledger entry or an exception to the rule.
  if (code.startsWith('ORDER_')) return 'orders';
  if (code.startsWith('ASSET_')) return 'assets_library';
  if (code.startsWith('CMS_')) return 'cms';
  if (code.startsWith('MEGAMENU_')) return 'megamenu';
  if (code.startsWith('BLOG_')) return 'blog';
  if (code.startsWith('DICTIONARY_')) return 'dictionaries';
  // `INVALID_CREDENTIALS` is auth's sign-in failure and does not start with this
  // prefix, so it keeps routing to core. Only the credential-configuration
  // family lands here.
  if (code.startsWith('CREDENTIAL_')) return 'credentials';
  // Issue #194 — `MFA_*` routed to `core` by falling off the end of this
  // function, which is where its sentences would have gone missing unnoticed
  // (see `check-error-translations.ts`). The family belongs to the module that
  // owns it; the codes already ledgered as untranslated stay untranslated,
  // they simply look for their sentence in the right bundle now.
  if (code.startsWith('MFA_')) return 'mfa';
  if (code.startsWith('MODULE_')) return 'core';
  return 'core';
}

// ---------------------------------------------------------------------------
// The declared routing map — feature 090
// (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §4)
// ---------------------------------------------------------------------------

/**
 * One manifest, and the file it was declared in.
 *
 * Structurally what `RegisteredManifestEntry` already is, restated here rather
 * than imported: `_lifecycle` owns that type and a module may not name a file in
 * another module's directory. The `filePath` is not decoration — it is what
 * §3.1 rule 3 requires a collision report to name for **every** claimant, and
 * with 67 modules a module id alone does not tell an operator which package on
 * their disk to look at.
 */
export interface ErrorCodeDeclarationSource {
  readonly manifest: {
    readonly id: string;
    // `| undefined` explicitly, because `exactOptionalPropertyTypes` is on and
    // `ModuleManifest.errorCodes` is `T[] | undefined` rather than an absent
    // property — without it a real `RegisteredManifestEntry` is not assignable
    // to this shape at all, which is the only shape callers ever pass.
    readonly errorCodes?: readonly { readonly code: string }[] | undefined;
  };
  readonly filePath: string;
}

/** One module's claim on a code. */
export interface ErrorCodeClaim {
  readonly moduleId: string;
  readonly declaredIn: string;
}

/** A code more than one registered module declares. Nobody wins. */
export interface ErrorCodeCollision {
  readonly code: string;
  readonly claims: readonly ErrorCodeClaim[];
}

export interface ErrorTranslationTargets {
  readonly targets: Readonly<Record<string, ErrorTranslationTarget>>;
  readonly collisions: readonly ErrorCodeCollision[];
}

/**
 * Which bundle holds which code's sentence, derived from the manifests.
 *
 * The input is **every registered manifest** — core, this deployment's overlay
 * modules and every installed package — which is the set `resolvedManifestEntries()`
 * produces and `admin_roles` builds the permission catalogue from. Activation
 * and platform availability are **not** consulted, and that is a standing ruling
 * rather than an omission (`specs/082-error-code-ownership/contracts/error-code-ownership.md`
 * §1.3): a code owned by a switchable module is raised by other modules too, so
 * a switched-off `carts` must not cost `orders` its checkout sentence.
 *
 * **Collisions: nobody wins** (§3). A code more than one module declares is
 * *absent* from `targets` and present in `collisions` with every claimant named.
 * There is no tie-break — not first-wins, not last-wins, not by origin, not by
 * manifest order, not by module id — because every one of them renders one
 * raiser's condition under the other's sentence: good prose about the wrong
 * thing, with no symptom an operator or a client can detect. The envelope
 * already rules that trade at five other exits from the same hook, and the
 * answer is the same one: untranslated prose which is true beats a rendered
 * sentence that is not.
 *
 * **One derivation** (D-100): the report and the routing come out of this one
 * call, so they cannot come to disagree about which codes are contested.
 *
 * **Deterministic**: the answer does not depend on the order the manifests
 * arrive in. Claims are sorted by module id, collisions by code.
 *
 * **This is the end state, and it is not what the roots inject today.** No module
 * has migrated yet, so over the resolved manifest set this function returns an
 * empty map — injecting it alone would take every operator-visible sentence in
 * both shipped languages out of reach at once. {@link composeErrorTranslationTargets}
 * is what the roots call while the migration is in flight; it is deleted with
 * the chain, and the roots then call this.
 */
export function buildErrorTranslationTargets(
  manifests: readonly ErrorCodeDeclarationSource[],
): ErrorTranslationTargets {
  const claimsByCode = new Map<string, ErrorCodeClaim[]>();
  for (const entry of manifests) {
    for (const declaration of entry.manifest.errorCodes ?? []) {
      const claims = claimsByCode.get(declaration.code);
      const claim: ErrorCodeClaim = {
        moduleId: entry.manifest.id,
        declaredIn: entry.filePath,
      };
      if (claims) claims.push(claim);
      else claimsByCode.set(declaration.code, [claim]);
    }
  }

  const targets: Record<string, ErrorTranslationTarget> = {};
  const collisions: ErrorCodeCollision[] = [];
  for (const [code, claims] of claimsByCode) {
    if (claims.length === 1) {
      targets[code] = { moduleId: claims[0]!.moduleId, key: `errors.${code}` };
      continue;
    }
    collisions.push({
      code,
      claims: [...claims].sort(
        (a, b) => a.moduleId.localeCompare(b.moduleId) || a.declaredIn.localeCompare(b.declaredIn),
      ),
    });
  }
  return { targets, collisions: collisions.sort((a, b) => a.code.localeCompare(b.code)) };
}

/**
 * The map both composition roots inject **while the migration is in flight** —
 * the declarations, over the incumbent chain (feature 090, Phase 2).
 *
 * `contracts/error-code-declaration.md` §6.4 makes the migration one merge
 * request per owning module, and §6.2 makes it answer-preserving over all of
 * `ERROR_CODES`. Those two together are only satisfiable if a code the owner has
 * not declared yet keeps the answer the chain gives it. So this is a transitional
 * shape with a scheduled death: the last merge request of Phase 3 deletes
 * {@link ERROR_TRANSLATION_KEYS}, deletes this function, and points both roots at
 * {@link buildErrorTranslationTargets}. Nothing new should be built on it.
 *
 * Three rules, and the reason for each is why they are not interchangeable:
 *
 *  1. **A declaration wins over the chain.** Chain-first is the one arrangement
 *     in which a declaration that disagrees with the chain changes nothing until
 *     the chain is deleted — which is the last merge request of the migration and
 *     the worst possible place to discover eighteen merge requests' worth of
 *     drift. Declaration-first makes the equality harness
 *     (`backend/test/unit/_i18n/error-code-routing-equality.test.ts`) report the
 *     disagreement on the day it lands.
 *  2. **The chain answers for a code nobody has declared.** That is the whole
 *     reason this function exists rather than the roots injecting the derivation.
 *  3. **A contested code is absent, chain or no chain.** §3.1 rule 1 says a code
 *     more than one module declares routes to none of them; letting the incumbent
 *     answer instead would be exactly the origin precedence §3.4 refuses by name —
 *     the platform's own table quietly outranking a claim it cannot see, which
 *     renders one raiser's condition under another's sentence.
 *
 * The collisions come out of the one `buildErrorTranslationTargets` call this
 * makes, so the routing and the report still cannot disagree (D-100).
 */
export function composeErrorTranslationTargets(
  manifests: readonly ErrorCodeDeclarationSource[],
): ErrorTranslationTargets {
  const declared = buildErrorTranslationTargets(manifests);
  const contested = new Set(declared.collisions.map((collision) => collision.code));

  const targets: Record<string, ErrorTranslationTarget> = {};
  for (const [code, target] of Object.entries(ERROR_TRANSLATION_KEYS)) {
    if (contested.has(code)) continue;
    targets[code] = target;
  }
  for (const [code, target] of Object.entries(declared.targets)) {
    targets[code] = target;
  }
  return { targets, collisions: declared.collisions };
}

/** One line per claimant, in the words an operator reads on `/platform/modules`. */
export function describeErrorCodeCollisions(
  collisions: readonly ErrorCodeCollision[],
): string {
  return collisions
    .map(
      (collision) =>
        `  - "${collision.code}" is declared by ${collision.claims.length} modules and ` +
        'therefore routes to none of them; the raising code\'s own message is answered ' +
        'until one of them gives it up:\n' +
        collision.claims
          .map((claim) => `      ${claim.moduleId} (${claim.declaredIn})`)
          .join('\n'),
    )
    .join('\n');
}
