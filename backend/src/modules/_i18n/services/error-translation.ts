import { ERROR_CODES, type ErrorCode } from '@b2b/contracts';

export interface ErrorTranslationTarget {
  moduleId: string;
  key: `errors.${ErrorCode}`;
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
  Object.values(ERROR_CODES).map((code) => [
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
