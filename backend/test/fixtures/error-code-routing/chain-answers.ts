/**
 * The prefix chain's routing answer for every error code, frozen.
 *
 * `specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §6.3:
 * *"The assertion's reference side is written **before** the chain is deleted
 * and survives as a frozen fixture afterwards."* This is that reference side.
 *
 * **What it is.** One entry per member of `ERROR_CODES`, mapping the code to the
 * module id `moduleIdForErrorCode` answers for it — the private function inside
 * `packages/modules/_i18n/src/backend/services/error-translation.ts` that
 * `ERROR_TRANSLATION_KEYS` is built from. It is grouped by module and sorted, so
 * a migration merge request that moves a family shows the family moving.
 *
 * **Why it is committed rather than computed.** While the chain exists, a
 * reference computed from the chain and compared to the chain is a tautology:
 * it agrees with whatever the chain says, including with a chain somebody has
 * just broken. Freezing the answer makes the comparison say something — and it
 * is the only form of the assertion that survives feature 090's Phase 3, where
 * the chain is deleted and the declarations become the candidate side with
 * nothing left to compute a reference from.
 *
 * **How it was produced.** Once, mechanically, at `49f3c6817`:
 *
 * ```
 * node --input-type=module -e "
 *   import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
 *   for (const [code, t] of Object.entries(ERROR_TRANSLATION_KEYS))
 *     console.log(code, t.moduleId);
 * "
 * ```
 *
 * It is **not** regenerated. **There is nothing left to regenerate it from**:
 * feature 090's Phase 4 deleted `moduleIdForErrorCode` and
 * `ERROR_TRANSLATION_KEYS`, so this file is the only record of what the chain
 * said, which is exactly what a reference is for.
 * `test/unit/_i18n/error-code-routing-equality.test.ts` reconciles it against
 * the map the composition roots now derive from the modules' own declarations,
 * on every run and in both directions — so a hand edit here fails, and a
 * declaration that disagrees with it fails. A change that deliberately re-routes
 * a code (D-129's scheduled sweep is the one in prospect) is a change to this
 * file **and** an argument in its merge request, never a regeneration.
 *
 * `core` is a routing answer and not a module directory: the platform-wide
 * bundle is `_i18n`'s own. Feature 090 FR-042 replaced the fall-through that
 * produced most of this block with `_i18n`'s explicit declaration, and
 * {@link CHAIN_ANSWERS_AS_MODULE_IDS} is where the two vocabularies are
 * reconciled — at this file's edge, because a reference a migration may rewrite
 * is a reference that agrees with whatever the migration did.
 */
export const CHAIN_ROUTING_ANSWERS: Readonly<Record<string, string>> = {
  // assets_library (15)
  ASSET_ACCESS_DENIED: 'assets_library',
  ASSET_FILE_MISSING: 'assets_library',
  ASSET_FOLDER_CYCLE: 'assets_library',
  ASSET_FOLDER_NAME_CONFLICT: 'assets_library',
  ASSET_FOLDER_NOT_EMPTY: 'assets_library',
  ASSET_FOLDER_NOT_FOUND: 'assets_library',
  ASSET_GONE: 'assets_library',
  ASSET_LEGACY_LOCATOR_CANNOT_HARDEN: 'assets_library',
  ASSET_NOT_FOUND: 'assets_library',
  ASSET_REFERENCED: 'assets_library',
  ASSET_STORAGE_MISCONFIGURED: 'assets_library',
  ASSET_STORAGE_UNAVAILABLE: 'assets_library',
  ASSET_UPLOAD_NO_FILE: 'assets_library',
  ASSET_UPLOAD_TOO_LARGE: 'assets_library',
  ASSET_UPLOAD_TYPE_NOT_ALLOWED: 'assets_library',

  // blog (19)
  BLOG_ASSET_KIND_MISMATCH: 'blog',
  BLOG_CATEGORY_CYCLE: 'blog',
  BLOG_CATEGORY_HAS_CHILDREN: 'blog',
  BLOG_CATEGORY_IN_USE: 'blog',
  BLOG_CATEGORY_NOT_FOUND: 'blog',
  BLOG_CATEGORY_NO_CHANNEL: 'blog',
  BLOG_CATEGORY_PROTECTED: 'blog',
  BLOG_DISABLED: 'blog',
  BLOG_POST_NOT_FOUND: 'blog',
  BLOG_POST_NO_CHANNEL: 'blog',
  BLOG_POST_NO_LANGUAGE: 'blog',
  BLOG_RELATED_POST_SELF_REFERENCE: 'blog',
  BLOG_SLUG_INVALID: 'blog',
  BLOG_SLUG_TAKEN: 'blog',
  BLOG_TAG_CODE_TAKEN: 'blog',
  BLOG_TAG_IN_USE: 'blog',
  BLOG_TAG_NOT_FOUND: 'blog',
  BLOG_URL_PREFIX_INVALID: 'blog',
  BLOG_URL_PREFIX_RESERVED: 'blog',

  // carts (3)
  CART_COUPON_REJECTED: 'carts',
  CART_EMPTY: 'carts',
  CART_LINE_CAP_EXCEEDED: 'carts',

  // catalog (47)
  ASSET_KIND_NOT_SUPPORTED: 'catalog',
  ATTACHMENT_NOT_FOUND: 'catalog',
  ATTACHMENT_TYPE_CODE_TAKEN: 'catalog',
  ATTACHMENT_TYPE_IN_USE: 'catalog',
  ATTACHMENT_TYPE_NOT_FOUND: 'catalog',
  ATTRIBUTE_NOT_FOUND: 'catalog',
  ATTRIBUTE_NOT_MASS_EDITABLE: 'catalog',
  ATTRIBUTE_SET_CODE_TAKEN: 'catalog',
  ATTRIBUTE_SET_IN_USE: 'catalog',
  ATTRIBUTE_SET_NOT_FOUND: 'catalog',
  ATTRIBUTE_VALUE_REJECTED: 'catalog',
  BUNDLE_SLOT_NOT_FOUND: 'catalog',
  BUNDLE_SLOT_OPTION_NOT_FOUND: 'catalog',
  FIELD_IMMUTABLE: 'catalog',
  FILTER_NOT_ALLOWED: 'catalog',
  GALLERY_ITEM_NOT_FOUND: 'catalog',
  GALLERY_LABEL_ALREADY_TAKEN: 'catalog',
  GALLERY_LABEL_LIMIT_EXCEEDED: 'catalog',
  GROUPED_ITEM_NOT_FOUND: 'catalog',
  INVALID_QUANTITY_RANGE: 'catalog',
  LINK_ALREADY_EXISTS: 'catalog',
  MAX_EXCEEDED: 'catalog',
  MIN_NOT_MET: 'catalog',
  NESTED_COMPOSITE_NOT_ALLOWED: 'catalog',
  OPTION_ALREADY_EXISTS: 'catalog',
  PRICE_ORDERING_UNAVAILABLE: 'catalog',
  PRICE_RANGE_INVALID: 'catalog',
  PRODUCT_ARCHIVED: 'catalog',
  PRODUCT_DELETE_BLOCKED: 'catalog',
  PRODUCT_FEED_CONFIRMATION_REQUIRED: 'catalog',
  PRODUCT_FEED_DISABLED: 'catalog',
  PRODUCT_FEED_TAXONOMY_CONFLICT: 'catalog',
  PRODUCT_FEED_TEMPLATE_CONFLICT: 'catalog',
  PRODUCT_FEED_TEMPLATE_UNBOUND: 'catalog',
  PRODUCT_IN_STOCK: 'catalog',
  PRODUCT_LINK_NOT_FOUND: 'catalog',
  PRODUCT_NOT_FOUND: 'catalog',
  PRODUCT_NOT_IN_COMPARISON: 'catalog',
  PRODUCT_TYPE_MISMATCH: 'catalog',
  PRODUCT_UNMANAGED_STOCK: 'catalog',
  SELF_LINK_NOT_ALLOWED: 'catalog',
  SKU_ALREADY_EXISTS: 'catalog',
  SKU_NOT_IN_ASSORTMENT: 'catalog',
  TARGET_PRODUCT_NOT_FOUND: 'catalog',
  UNKNOWN_OPTION: 'catalog',
  VARIANT_AXIS_MISSING: 'catalog',
  VARIANT_COMBINATION_EXISTS: 'catalog',

  // cms (10)
  CMS_BLOCK_NOT_FOUND: 'cms',
  CMS_CODE_CONFLICT: 'cms',
  CMS_HOOK_NOT_FOUND: 'cms',
  CMS_HOOK_SYSTEM_PROTECTED: 'cms',
  CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE: 'cms',
  CMS_PAGE_NOT_FOUND: 'cms',
  CMS_REFERENCED: 'cms',
  CMS_SCHEMA_UPGRADE_FAILED: 'cms',
  CMS_SLUG_CONFLICT: 'cms',
  CMS_TEMPLATE_NOT_FOUND: 'cms',

  // comparisons (4)
  COMPARISON_EMPTY: 'comparisons',
  COMPARISON_FULL: 'comparisons',
  COMPARISON_NOT_FOUND: 'comparisons',
  PDF_GENERATION_FAILED: 'comparisons',

  // core (100 captured; 80 since pim_ergonode's thirteen and ksef's seven left —
  // see below)
  ACCOUNT_BLOCKED: 'core',
  ACTIVE_RESERVATIONS_EXIST: 'core',
  ADDRESS_IN_USE: 'core',
  ADDRESS_NOT_OWNED: 'core',
  ADJUSTMENT_BELOW_ACTIVE: 'core',
  ADMIN_ROLE_CODE_TAKEN: 'core',
  ADMIN_ROLE_IN_USE: 'core',
  ADMIN_ROLE_PROTECTED: 'core',
  ALREADY_SUBSCRIBED: 'core',
  API_KEY_CHANNEL_MISMATCH: 'core',
  API_KEY_NOT_BOUND: 'core',
  API_KEY_OUT_OF_SCOPE: 'core',
  ASSISTANT_DISABLED: 'core',
  ASSISTANT_NOT_CONFIGURED: 'core',
  BULK_TOO_LARGE: 'core',
  CANNOT_DEMOTE_LAST_ADMIN: 'core',
  CANNOT_REMOVE_LAST_ADMIN: 'core',
  CANNOT_REVOKE_LAST_ADMIN_INVITE: 'core',
  CREDIT_LIMIT_ALREADY_GRANTED: 'core',
  CREDIT_LIMIT_NOT_GRANTED: 'core',
  CURRENCY_MISMATCH: 'core',
  CURRENT_PASSWORD_INVALID: 'core',
  CUSTOMER_ADDRESS_NOT_FOUND: 'core',
  CUSTOMER_ALREADY_DELETED: 'core',
  CUSTOMER_NOT_DELETED: 'core',
  CUSTOMER_NOT_FOUND: 'core',
  CUSTOMER_RESTORE_WINDOW_ELAPSED: 'core',
  CUSTOM_FIELD_DEFINITION_INVALID: 'core',
  CUSTOM_FIELD_HOST_MANAGED: 'core',
  CUSTOM_FIELD_KEY_CONFLICT: 'core',
  CUSTOM_FIELD_NOT_FOUND: 'core',
  CUSTOM_FIELD_VALUE_INVALID: 'core',
  EMAIL_ALREADY_IN_ORGANIZATION: 'core',
  EMAIL_ALREADY_REGISTERED: 'core',
  EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION: 'core',
  FORBIDDEN: 'core',
  IDEMPOTENCY_KEY_REQUIRED: 'core',
  IDEMPOTENCY_KEY_REUSED: 'core',
  INTERNAL: 'core',
  INVALID_CREDENTIALS: 'core',
  INVALID_TRANSITION: 'core',
  // KSEF_* (7) were here, answered `core`, and are not any more: D-129's sweep
  // re-homed them to `ksef`, and that module left this repository for the paid
  // one with them as its own `ksefErrorCodes` (feature 134, T069).
  // `ERROR_CODES` no longer holds them, so the capture's own rule — one entry
  // per member — drops them; this is the deliberate change the header asks to be
  // argued rather than regenerated, and nothing else in the capture moves. The
  // chain's answer for them is `git show f75de58e9:` this file.
  LIMIT_INSUFFICIENT: 'core',
  MODULE_ACTIVATION_PROTECTED: 'core',
  MODULE_DEPENDENCIES_ABSENT: 'core',
  MODULE_DEPENDENTS_PRESENT: 'core',
  MODULE_DISABLED: 'core',
  MODULE_NOT_DEACTIVATABLE: 'core',
  MODULE_NOT_FOUND: 'core',
  MODULE_SETTING_READ_ONLY: 'core',
  NOT_FOUND: 'core',
  ORGANIZATION_HAS_CHILDREN: 'core',
  ORGANIZATION_SUSPENDED: 'core',
  ORGANIZATION_TAX_ID_EXISTS: 'core',
  ORGANIZATION_TREE_INVALID: 'core',
  ORG_OWNER_DEPLETION: 'core',
  PACKAGING_UNIT_NAME_CONFLICT: 'core',
  PACKAGING_UNIT_NOT_FOUND: 'core',
  PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE: 'core',
  // PIM_ERGONODE_* (13) were here, answered `core`, and are not any more: D-129's
  // sweep re-homed them to `pim_ergonode`, and that module left this repository
  // for the paid one with them as its own `pimErgonodeErrorCodes` (feature 134,
  // T055). `ERROR_CODES` no longer holds them, so the capture's own rule — one
  // entry per member — drops them; this is the deliberate change the header
  // asks to be argued rather than regenerated, and nothing else in the capture
  // moves. The chain's answer for them is `git show ec3f86cb4:` this file.
  PRICE_LIST_NOT_FOUND: 'core',
  PRICE_UNAVAILABLE: 'core',
  PROMOTION_INVALID: 'core',
  PROMPT_PERMISSION_REVOKED: 'core',
  PROMPT_PLAN_EXPIRED: 'core',
  PROMPT_REQUEST_INVALID_STATE: 'core',
  PROMPT_REQUEST_IN_FLIGHT: 'core',
  RATE_LIMITED: 'core',
  REGISTRATION_REQUIRES_ORGANIZATION: 'core',
  SELECTION_TOO_LARGE: 'core',
  SHOPPING_LIST_CANNOT_DELETE_DEFAULT: 'core',
  SHOPPING_LIST_CANNOT_DELETE_LAST: 'core',
  SYSTEM_ATTRIBUTE_SET_IMMUTABLE: 'core',
  TERMS_VERSION_STALE: 'core',
  TOKEN_INVALID_OR_EXPIRED: 'core',
  TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE: 'core',
  TWO_FACTOR_REQUIRED: 'core',
  TWO_FACTOR_REQUIRED_BY_ROLE: 'core',
  UNAUTHORIZED: 'core',
  VALIDATION_FAILED: 'core',
  VERSION_CONFLICT: 'core',
  WEBHOOK_DELIVERY_NOT_REPLAYABLE: 'core',

  // credentials (6)
  CREDENTIAL_CODE_TAKEN: 'credentials',
  CREDENTIAL_IN_USE: 'credentials',
  CREDENTIAL_NOT_FOUND: 'credentials',
  CREDENTIAL_TYPE_IMMUTABLE: 'credentials',
  CREDENTIAL_TYPE_UNKNOWN: 'credentials',
  CREDENTIAL_VALIDATION_FAILED: 'credentials',

  // dictionaries (8)
  DICTIONARY_CODE_IMMUTABLE: 'dictionaries',
  DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED: 'dictionaries',
  DICTIONARY_ENTRY_HAS_DEPENDENTS: 'dictionaries',
  DICTIONARY_ENTRY_INACTIVE: 'dictionaries',
  DICTIONARY_ENTRY_NOT_FOUND: 'dictionaries',
  DICTIONARY_FALLBACK_CYCLE: 'dictionaries',
  DICTIONARY_LAST_ACTIVE_ENTRY: 'dictionaries',
  DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE: 'dictionaries',

  // inventory (13)
  AVAILABILITY_NOTIFICATION_NOT_FOUND: 'inventory',
  CHANNEL_NO_WAREHOUSES: 'inventory',
  CHANNEL_WAREHOUSE_NOT_FOUND: 'inventory',
  STOCK_IMPORT_INVALID_FILE: 'inventory',
  STOCK_LEVEL_NOT_FOUND: 'inventory',
  STOCK_UNAVAILABLE: 'inventory',
  THRESHOLDS_INVALID: 'inventory',
  WAREHOUSE_CANNOT_DELETE_DEFAULT: 'inventory',
  WAREHOUSE_CODE_TAKEN: 'inventory',
  WAREHOUSE_HAS_STOCK: 'inventory',
  WAREHOUSE_INVALID_CODE: 'inventory',
  WAREHOUSE_IS_DEFAULT_FOR_CHANNELS: 'inventory',
  WAREHOUSE_NOT_FOUND: 'inventory',

  // invoices (3)
  INVOICE_NOT_READY: 'invoices',
  INVOICE_NUMBER_ALREADY_ISSUED: 'invoices',
  INVOICE_NUMBER_PATTERN_COLLIDES: 'invoices',

  // megamenu (10)
  MEGAMENU_ASSET_KIND_MISMATCH: 'megamenu',
  MEGAMENU_BINDING_ALREADY_EXISTS: 'megamenu',
  MEGAMENU_BINDING_NOT_FOUND: 'megamenu',
  MEGAMENU_DEPTH_EXCEEDED: 'megamenu',
  MEGAMENU_EMPTY_TREE: 'megamenu',
  MEGAMENU_HAS_ACTIVE_BINDINGS: 'megamenu',
  MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE: 'megamenu',
  MEGAMENU_NOT_FOUND: 'megamenu',
  MEGAMENU_REFERENCED: 'megamenu',
  MEGAMENU_TARGET_OUT_OF_SCOPE: 'megamenu',

  // mfa (10)
  MFA_ALREADY_ENROLLED: 'mfa',
  MFA_INVALID_CHALLENGE: 'mfa',
  MFA_INVALID_CODE: 'mfa',
  MFA_NOT_ENABLED: 'mfa',
  MFA_NO_ACTIVE_ENROLMENT: 'mfa',
  MFA_NO_PENDING_ENROLMENT: 'mfa',
  MFA_REAUTH_REQUIRED: 'mfa',
  MFA_SOCIAL_LAST_CREDENTIAL: 'mfa',
  MFA_TOO_MANY_ATTEMPTS: 'mfa',
  MFA_WRONG_SURFACE: 'mfa',

  // orders (2)
  ORDER_NOT_CANCELLABLE: 'orders',
  ORDER_NOT_FOUND: 'orders',

  // quote_requests (9)
  QUOTE_INCOMPLETE: 'quote_requests',
  QUOTE_VALIDITY_ENDED: 'quote_requests',
  RFQ_ALREADY_CLAIMED: 'quote_requests',
  RFQ_EMPTY: 'quote_requests',
  RFQ_EXPIRED: 'quote_requests',
  RFQ_NOT_ACCEPTED: 'quote_requests',
  RFQ_NOT_DRAFT: 'quote_requests',
  RFQ_NOT_NEW: 'quote_requests',
  RFQ_NOT_QUOTED: 'quote_requests',

  // sales_channels (12)
  CANNOT_MODIFY_SYSTEM_DEFAULT: 'sales_channels',
  DUPLICATE_SALES_CHANNEL_CODE: 'sales_channels',
  ENTITY_WOULD_HAVE_ZERO_CHANNELS: 'sales_channels',
  INACTIVE_SALES_CHANNEL: 'sales_channels',
  MISSING_SALES_CHANNEL_CONTEXT: 'sales_channels',
  SALES_CHANNEL_ATTRIBUTION_IMMUTABLE: 'sales_channels',
  SALES_CHANNEL_CODE_IMMUTABLE: 'sales_channels',
  SALES_CHANNEL_HAS_ATTRIBUTIONS: 'sales_channels',
  STALE_SALES_CHANNEL_WRITE: 'sales_channels',
  UNKNOWN_CURRENCY_CODE: 'sales_channels',
  UNKNOWN_LANGUAGE_CODE: 'sales_channels',
  UNKNOWN_SALES_CHANNEL: 'sales_channels',

  // search (8)
  LIMIT_OUT_OF_RANGE: 'search',
  LLM_CONFIG_INCOMPLETE: 'search',
  PHRASE_REQUIRED: 'search',
  PHRASE_TOO_LONG: 'search',
  QUERY_TOO_LONG: 'search',
  QUERY_TOO_SHORT: 'search',
  RESULT_COUNT_INVALID: 'search',
  SEARCH_BACKEND_UNAVAILABLE: 'search',

  // settings (10)
  SETTING_BREAKING_CHANGE_REJECTED: 'settings',
  SETTING_CODE_CONFLICT: 'settings',
  SETTING_EMPTY_SUBSET: 'settings',
  SETTING_GROUP_CODE_CONFLICT: 'settings',
  SETTING_GROUP_NOT_FOUND: 'settings',
  SETTING_GROUP_PROTECTED: 'settings',
  SETTING_NOT_REGISTERED: 'settings',
  SETTING_OUT_OF_SCOPE_FOR_CHANNEL: 'settings',
  SETTING_SECRET_KEY_MISSING: 'settings',
  SETTING_VALUE_SHAPE_MISMATCH: 'settings',
};

/**
 * The one value in {@link CHAIN_ROUTING_ANSWERS} that is **not** a module id.
 *
 * `core` is the synthetic namespace `_i18n`'s bundle is exposed under at the
 * resolver boundary (feature 019; `I18nService`'s `exposedBundleNamespace`).
 * The declaration mechanism feature 090 replaces the chain with is keyed on
 * module ids, so the platform block's declaration necessarily says `_i18n`
 * where the chain said `core` — 100 codes, and `compareErrorCodeRouting` calls
 * every one of them `rerouted` unless the two vocabularies are reconciled
 * somewhere.
 *
 * **The capture is not where.** It is the reference side of every Phase 3
 * assertion and a migration does not edit it: a reference a migration may
 * rewrite is one that agrees with whatever the migration did
 * (`specs/090-module-owned-error-codes/migration-runbook.md` §1). So the
 * identity is named once, here, at the capture's edge, and both harnesses read
 * the capture through {@link CHAIN_ANSWERS_AS_MODULE_IDS} rather than
 * carrying a `=== 'core'` test of their own. It is a transitional alias in a
 * transitional artefact and it retires with the capture.
 *
 * `specs/090-module-owned-error-codes/core-block-home.md` §4(d) is the ruling.
 */
export const PLATFORM_BUNDLE_MODULE_ID = '_i18n';

/** Chain answer → the module id that answers for it. */
export const CHAIN_ANSWER_ALIASES: Readonly<Record<string, string>> = {
  core: PLATFORM_BUNDLE_MODULE_ID,
};

/**
 * {@link CHAIN_ROUTING_ANSWERS} with every answer expressed as a module id —
 * the form a manifest declaration can be compared to.
 *
 * Derived, never a second hand-written table: the two differ in exactly the
 * entries {@link CHAIN_ANSWER_ALIASES} names, so they cannot drift.
 */
export const CHAIN_ANSWERS_AS_MODULE_IDS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CHAIN_ROUTING_ANSWERS).map(([code, answer]) => [
      code,
      CHAIN_ANSWER_ALIASES[answer] ?? answer,
    ]),
  );
