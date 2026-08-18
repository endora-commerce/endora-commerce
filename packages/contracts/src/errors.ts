import { z } from 'zod';

/**
 * Central catalog of API error codes — see specs/001-b2b-platform-foundation/contracts/README.md.
 *
 * Every non-2xx response SHOULD use one of these codes. The list grows as modules are added;
 * new codes MUST be screaming-snake-case and documented in the relevant contract file.
 */
export const ERROR_CODES = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',

  // Catalog
  FILTER_NOT_ALLOWED: 'FILTER_NOT_ALLOWED',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',

  // Catalog 086 — the viewer's own price as an ordering and as a filter.
  //
  // `FILTER_NOT_ALLOWED` is deliberately not reused for either: it means "this
  // attribute is not filterable", and a price is not an attribute — the
  // `'price'` occurrences in `catalog-query.service.ts` are an attribute
  // *value type*, so the message would read as though an operator could switch
  // price filtering on in the attribute editor.
  PRICE_ORDERING_UNAVAILABLE: 'PRICE_ORDERING_UNAVAILABLE',
  PRICE_RANGE_INVALID: 'PRICE_RANGE_INVALID',
  PRODUCT_ARCHIVED: 'PRODUCT_ARCHIVED',
  PRODUCT_DELETE_BLOCKED: 'PRODUCT_DELETE_BLOCKED',
  SKU_ALREADY_EXISTS: 'SKU_ALREADY_EXISTS',
  VARIANT_COMBINATION_EXISTS: 'VARIANT_COMBINATION_EXISTS',
  VARIANT_AXIS_MISSING: 'VARIANT_AXIS_MISSING',
  ATTRIBUTE_VALUE_REJECTED: 'ATTRIBUTE_VALUE_REJECTED',
  FIELD_IMMUTABLE: 'FIELD_IMMUTABLE',

  // Catalog 002 — Attribute Sets
  ATTRIBUTE_SET_CODE_TAKEN: 'ATTRIBUTE_SET_CODE_TAKEN',
  ATTRIBUTE_SET_IN_USE: 'ATTRIBUTE_SET_IN_USE',
  SYSTEM_ATTRIBUTE_SET_IMMUTABLE: 'SYSTEM_ATTRIBUTE_SET_IMMUTABLE',
  ATTRIBUTE_SET_NOT_FOUND: 'ATTRIBUTE_SET_NOT_FOUND',
  ATTRIBUTE_NOT_FOUND: 'ATTRIBUTE_NOT_FOUND',

  // Catalog 002 — Gallery + Attachments (US3)
  GALLERY_LABEL_ALREADY_TAKEN: 'GALLERY_LABEL_ALREADY_TAKEN',
  GALLERY_LABEL_LIMIT_EXCEEDED: 'GALLERY_LABEL_LIMIT_EXCEEDED',
  ASSET_KIND_NOT_SUPPORTED: 'ASSET_KIND_NOT_SUPPORTED',
  ATTACHMENT_TYPE_IN_USE: 'ATTACHMENT_TYPE_IN_USE',
  ATTACHMENT_TYPE_CODE_TAKEN: 'ATTACHMENT_TYPE_CODE_TAKEN',
  ATTACHMENT_TYPE_NOT_FOUND: 'ATTACHMENT_TYPE_NOT_FOUND',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  GALLERY_ITEM_NOT_FOUND: 'GALLERY_ITEM_NOT_FOUND',

  // Catalog 043 — Packaging units
  PACKAGING_UNIT_NOT_FOUND: 'PACKAGING_UNIT_NOT_FOUND',
  PACKAGING_UNIT_NAME_CONFLICT: 'PACKAGING_UNIT_NAME_CONFLICT',
  PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE: 'PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE',

  // Catalog 002 — Product Links (US4)
  SELF_LINK_NOT_ALLOWED: 'SELF_LINK_NOT_ALLOWED',
  LINK_ALREADY_EXISTS: 'LINK_ALREADY_EXISTS',
  TARGET_PRODUCT_NOT_FOUND: 'TARGET_PRODUCT_NOT_FOUND',
  PRODUCT_LINK_NOT_FOUND: 'PRODUCT_LINK_NOT_FOUND',

  // Catalog 002 — Grouped/Bundle/Virtual composite products (US5)
  PRODUCT_TYPE_MISMATCH: 'PRODUCT_TYPE_MISMATCH',
  NESTED_COMPOSITE_NOT_ALLOWED: 'NESTED_COMPOSITE_NOT_ALLOWED',
  INVALID_QUANTITY_RANGE: 'INVALID_QUANTITY_RANGE',
  OPTION_ALREADY_EXISTS: 'OPTION_ALREADY_EXISTS',
  GROUPED_ITEM_NOT_FOUND: 'GROUPED_ITEM_NOT_FOUND',
  BUNDLE_SLOT_NOT_FOUND: 'BUNDLE_SLOT_NOT_FOUND',
  BUNDLE_SLOT_OPTION_NOT_FOUND: 'BUNDLE_SLOT_OPTION_NOT_FOUND',
  MIN_NOT_MET: 'MIN_NOT_MET',
  MAX_EXCEEDED: 'MAX_EXCEEDED',
  UNKNOWN_OPTION: 'UNKNOWN_OPTION',

  // Quote Requests (RFQ)
  RFQ_NOT_DRAFT: 'RFQ_NOT_DRAFT',
  RFQ_EMPTY: 'RFQ_EMPTY',
  RFQ_NOT_QUOTED: 'RFQ_NOT_QUOTED',
  RFQ_NOT_ACCEPTED: 'RFQ_NOT_ACCEPTED',
  RFQ_NOT_NEW: 'RFQ_NOT_NEW',
  RFQ_ALREADY_CLAIMED: 'RFQ_ALREADY_CLAIMED',
  RFQ_EXPIRED: 'RFQ_EXPIRED',
  QUOTE_INCOMPLETE: 'QUOTE_INCOMPLETE',
  QUOTE_VALIDITY_ENDED: 'QUOTE_VALIDITY_ENDED',

  // Shopping lists
  SHOPPING_LIST_CANNOT_DELETE_DEFAULT: 'SHOPPING_LIST_CANNOT_DELETE_DEFAULT',
  SHOPPING_LIST_CANNOT_DELETE_LAST: 'SHOPPING_LIST_CANNOT_DELETE_LAST',

  // Organizations / customer accounts
  ORGANIZATION_TAX_ID_EXISTS: 'ORGANIZATION_TAX_ID_EXISTS',
  // Feature 056 — deletion of a parent with children is blocked (reassign /
  // remove children first). Backed by the `parent_id ON DELETE RESTRICT` FK.
  ORGANIZATION_HAS_CHILDREN: 'ORGANIZATION_HAS_CHILDREN',
  // Feature 056 — a re-parent would create a cycle or exceed the depth bound.
  ORGANIZATION_TREE_INVALID: 'ORGANIZATION_TREE_INVALID',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  EMAIL_ALREADY_IN_ORGANIZATION: 'EMAIL_ALREADY_IN_ORGANIZATION',
  EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION: 'EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION',
  TERMS_VERSION_STALE: 'TERMS_VERSION_STALE',
  TOKEN_INVALID_OR_EXPIRED: 'TOKEN_INVALID_OR_EXPIRED',
  // Wrong email/password on login. A code distinct from the generic
  // UNAUTHORIZED ("authentication is required") guard so the storefront can
  // surface an actionable "invalid email or password — try again" message
  // instead of the opaque guard string (mirrors ACCOUNT_BLOCKED).
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  TWO_FACTOR_REQUIRED_BY_ROLE: 'TWO_FACTOR_REQUIRED_BY_ROLE',
  CANNOT_REMOVE_LAST_ADMIN: 'CANNOT_REMOVE_LAST_ADMIN',
  CANNOT_DEMOTE_LAST_ADMIN: 'CANNOT_DEMOTE_LAST_ADMIN',
  CANNOT_REVOKE_LAST_ADMIN_INVITE: 'CANNOT_REVOKE_LAST_ADMIN_INVITE',
  ADDRESS_IN_USE: 'ADDRESS_IN_USE',
  ADDRESS_NOT_OWNED: 'ADDRESS_NOT_OWNED',

  // Customers (040)
  REGISTRATION_REQUIRES_ORGANIZATION: 'REGISTRATION_REQUIRES_ORGANIZATION',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  CUSTOMER_ADDRESS_NOT_FOUND: 'CUSTOMER_ADDRESS_NOT_FOUND',
  CUSTOMER_ALREADY_DELETED: 'CUSTOMER_ALREADY_DELETED',
  CUSTOMER_NOT_DELETED: 'CUSTOMER_NOT_DELETED',
  CUSTOMER_RESTORE_WINDOW_ELAPSED: 'CUSTOMER_RESTORE_WINDOW_ELAPSED',
  ORG_OWNER_DEPLETION: 'ORG_OWNER_DEPLETION',

  // Orders + Carts (feature 027)
  CART_EMPTY: 'CART_EMPTY',
  CART_LINE_CAP_EXCEEDED: 'CART_LINE_CAP_EXCEEDED',
  CART_COUPON_REJECTED: 'CART_COUPON_REJECTED',
  STOCK_UNAVAILABLE: 'STOCK_UNAVAILABLE',
  PROMOTION_INVALID: 'PROMOTION_INVALID',
  ORGANIZATION_SUSPENDED: 'ORGANIZATION_SUSPENDED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_NOT_CANCELLABLE: 'ORDER_NOT_CANCELLABLE',
  INVOICE_NOT_READY: 'INVOICE_NOT_READY',
  // Invoices — number uniqueness (feature 078, D-95). The numbering series is
  // per (sales channel, kind, year) while `invoices.number` is unique across
  // the whole platform, so two channels whose patterns can render one string
  // are a duplicate waiting to happen. The first code refuses the
  // configuration, the second refuses the document.
  INVOICE_NUMBER_PATTERN_COLLIDES: 'INVOICE_NUMBER_PATTERN_COLLIDES',
  INVOICE_NUMBER_ALREADY_ISSUED: 'INVOICE_NUMBER_ALREADY_ISSUED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',

  // Credit Limit
  CREDIT_LIMIT_NOT_GRANTED: 'CREDIT_LIMIT_NOT_GRANTED',
  CREDIT_LIMIT_ALREADY_GRANTED: 'CREDIT_LIMIT_ALREADY_GRANTED',
  LIMIT_INSUFFICIENT: 'LIMIT_INSUFFICIENT',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  ADJUSTMENT_BELOW_ACTIVE: 'ADJUSTMENT_BELOW_ACTIVE',
  ACTIVE_RESERVATIONS_EXIST: 'ACTIVE_RESERVATIONS_EXIST',
  ALREADY_SUBSCRIBED: 'ALREADY_SUBSCRIBED',
  PRODUCT_IN_STOCK: 'PRODUCT_IN_STOCK',

  // API keys / webhooks / integrations
  API_KEY_OUT_OF_SCOPE: 'API_KEY_OUT_OF_SCOPE',
  WEBHOOK_DELIVERY_NOT_REPLAYABLE: 'WEBHOOK_DELIVERY_NOT_REPLAYABLE',

  // Distributor API (feature 062)
  API_KEY_NOT_BOUND: 'API_KEY_NOT_BOUND',
  API_KEY_CHANNEL_MISMATCH: 'API_KEY_CHANNEL_MISMATCH',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  SKU_NOT_IN_ASSORTMENT: 'SKU_NOT_IN_ASSORTMENT',
  PRICE_UNAVAILABLE: 'PRICE_UNAVAILABLE',

  // Admin users / roles
  ADMIN_ROLE_CODE_TAKEN: 'ADMIN_ROLE_CODE_TAKEN',
  ADMIN_ROLE_IN_USE: 'ADMIN_ROLE_IN_USE',

  // Settings (feature 004)
  SETTING_NOT_REGISTERED: 'SETTING_NOT_REGISTERED',
  SETTING_OUT_OF_SCOPE_FOR_CHANNEL: 'SETTING_OUT_OF_SCOPE_FOR_CHANNEL',
  SETTING_VALUE_SHAPE_MISMATCH: 'SETTING_VALUE_SHAPE_MISMATCH',
  SETTING_EMPTY_SUBSET: 'SETTING_EMPTY_SUBSET',
  SETTING_GROUP_PROTECTED: 'SETTING_GROUP_PROTECTED',
  SETTING_GROUP_NOT_FOUND: 'SETTING_GROUP_NOT_FOUND',
  SETTING_CODE_CONFLICT: 'SETTING_CODE_CONFLICT',
  SETTING_GROUP_CODE_CONFLICT: 'SETTING_GROUP_CODE_CONFLICT',
  SETTING_BREAKING_CHANGE_REJECTED: 'SETTING_BREAKING_CHANGE_REJECTED',
  // Settings 'secret' value type (feature 043)
  SETTING_SECRET_KEY_MISSING: 'SETTING_SECRET_KEY_MISSING',

  // Prompt actions (feature 043)
  ASSISTANT_DISABLED: 'ASSISTANT_DISABLED',
  ASSISTANT_NOT_CONFIGURED: 'ASSISTANT_NOT_CONFIGURED',
  PROMPT_REQUEST_INVALID_STATE: 'PROMPT_REQUEST_INVALID_STATE',
  PROMPT_PLAN_EXPIRED: 'PROMPT_PLAN_EXPIRED',
  PROMPT_PERMISSION_REVOKED: 'PROMPT_PERMISSION_REVOKED',
  PROMPT_REQUEST_IN_FLIGHT: 'PROMPT_REQUEST_IN_FLIGHT',

  // Search (feature 006)
  QUERY_TOO_SHORT: 'QUERY_TOO_SHORT',
  QUERY_TOO_LONG: 'QUERY_TOO_LONG',
  LIMIT_OUT_OF_RANGE: 'LIMIT_OUT_OF_RANGE',
  SEARCH_BACKEND_UNAVAILABLE: 'SEARCH_BACKEND_UNAVAILABLE',
  PHRASE_REQUIRED: 'PHRASE_REQUIRED',
  PHRASE_TOO_LONG: 'PHRASE_TOO_LONG',
  RESULT_COUNT_INVALID: 'RESULT_COUNT_INVALID',
  LLM_CONFIG_INCOMPLETE: 'LLM_CONFIG_INCOMPLETE',

  // Sales Channels (feature 005)
  UNKNOWN_SALES_CHANNEL: 'UNKNOWN_SALES_CHANNEL',
  INACTIVE_SALES_CHANNEL: 'INACTIVE_SALES_CHANNEL',
  MISSING_SALES_CHANNEL_CONTEXT: 'MISSING_SALES_CHANNEL_CONTEXT',
  DUPLICATE_SALES_CHANNEL_CODE: 'DUPLICATE_SALES_CHANNEL_CODE',
  UNKNOWN_LANGUAGE_CODE: 'UNKNOWN_LANGUAGE_CODE',
  UNKNOWN_CURRENCY_CODE: 'UNKNOWN_CURRENCY_CODE',
  CANNOT_MODIFY_SYSTEM_DEFAULT: 'CANNOT_MODIFY_SYSTEM_DEFAULT',
  SALES_CHANNEL_HAS_ATTRIBUTIONS: 'SALES_CHANNEL_HAS_ATTRIBUTIONS',
  ENTITY_WOULD_HAVE_ZERO_CHANNELS: 'ENTITY_WOULD_HAVE_ZERO_CHANNELS',
  STALE_SALES_CHANNEL_WRITE: 'STALE_SALES_CHANNEL_WRITE',
  SALES_CHANNEL_ATTRIBUTION_IMMUTABLE: 'SALES_CHANNEL_ATTRIBUTION_IMMUTABLE',
  SALES_CHANNEL_CODE_IMMUTABLE: 'SALES_CHANNEL_CODE_IMMUTABLE',

  // Compare (feature 007)
  COMPARISON_FULL: 'COMPARISON_FULL',
  COMPARISON_NOT_FOUND: 'COMPARISON_NOT_FOUND',
  COMPARISON_EMPTY: 'COMPARISON_EMPTY',
  PRODUCT_NOT_IN_COMPARISON: 'PRODUCT_NOT_IN_COMPARISON',
  PDF_GENERATION_FAILED: 'PDF_GENERATION_FAILED',

  // Inventory (feature 010 — multi-warehouse)
  WAREHOUSE_NOT_FOUND: 'WAREHOUSE_NOT_FOUND',
  WAREHOUSE_CODE_TAKEN: 'WAREHOUSE_CODE_TAKEN',
  WAREHOUSE_INVALID_CODE: 'WAREHOUSE_INVALID_CODE',
  WAREHOUSE_CANNOT_DELETE_DEFAULT: 'WAREHOUSE_CANNOT_DELETE_DEFAULT',
  WAREHOUSE_IS_DEFAULT_FOR_CHANNELS: 'WAREHOUSE_IS_DEFAULT_FOR_CHANNELS',
  WAREHOUSE_HAS_STOCK: 'WAREHOUSE_HAS_STOCK',
  CHANNEL_NO_WAREHOUSES: 'CHANNEL_NO_WAREHOUSES',
  CHANNEL_WAREHOUSE_NOT_FOUND: 'CHANNEL_WAREHOUSE_NOT_FOUND',
  STOCK_LEVEL_NOT_FOUND: 'STOCK_LEVEL_NOT_FOUND',
  THRESHOLDS_INVALID: 'THRESHOLDS_INVALID',
  PRODUCT_UNMANAGED_STOCK: 'PRODUCT_UNMANAGED_STOCK',
  AVAILABILITY_NOTIFICATION_NOT_FOUND: 'AVAILABILITY_NOTIFICATION_NOT_FOUND',
  STOCK_IMPORT_INVALID_FILE: 'STOCK_IMPORT_INVALID_FILE',

  // Assets Library (feature 013)
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_REFERENCED: 'ASSET_REFERENCED',
  ASSET_FOLDER_NOT_FOUND: 'ASSET_FOLDER_NOT_FOUND',
  ASSET_FOLDER_NOT_EMPTY: 'ASSET_FOLDER_NOT_EMPTY',
  ASSET_FOLDER_NAME_CONFLICT: 'ASSET_FOLDER_NAME_CONFLICT',
  ASSET_FOLDER_CYCLE: 'ASSET_FOLDER_CYCLE',
  ASSET_UPLOAD_NO_FILE: 'ASSET_UPLOAD_NO_FILE',
  ASSET_UPLOAD_TYPE_NOT_ALLOWED: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED',
  ASSET_UPLOAD_TOO_LARGE: 'ASSET_UPLOAD_TOO_LARGE',
  ASSET_STORAGE_UNAVAILABLE: 'ASSET_STORAGE_UNAVAILABLE',
  ASSET_STORAGE_MISCONFIGURED: 'ASSET_STORAGE_MISCONFIGURED',
  ASSET_LEGACY_LOCATOR_CANNOT_HARDEN: 'ASSET_LEGACY_LOCATOR_CANNOT_HARDEN',
  ASSET_FILE_MISSING: 'ASSET_FILE_MISSING',
  ASSET_GONE: 'ASSET_GONE',
  ASSET_ACCESS_DENIED: 'ASSET_ACCESS_DENIED',

  // CMS (feature 014)
  CMS_PAGE_NOT_FOUND: 'CMS_PAGE_NOT_FOUND',
  CMS_BLOCK_NOT_FOUND: 'CMS_BLOCK_NOT_FOUND',
  CMS_TEMPLATE_NOT_FOUND: 'CMS_TEMPLATE_NOT_FOUND',
  CMS_HOOK_NOT_FOUND: 'CMS_HOOK_NOT_FOUND',
  CMS_SLUG_CONFLICT: 'CMS_SLUG_CONFLICT',
  CMS_CODE_CONFLICT: 'CMS_CODE_CONFLICT',
  CMS_REFERENCED: 'CMS_REFERENCED',
  CMS_HOOK_SYSTEM_PROTECTED: 'CMS_HOOK_SYSTEM_PROTECTED',
  CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE: 'CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE',
  CMS_SCHEMA_UPGRADE_FAILED: 'CMS_SCHEMA_UPGRADE_FAILED',

  // Megamenu (feature 015)
  MEGAMENU_NOT_FOUND: 'MEGAMENU_NOT_FOUND',
  MEGAMENU_HAS_ACTIVE_BINDINGS: 'MEGAMENU_HAS_ACTIVE_BINDINGS',
  MEGAMENU_EMPTY_TREE: 'MEGAMENU_EMPTY_TREE',
  MEGAMENU_BINDING_NOT_FOUND: 'MEGAMENU_BINDING_NOT_FOUND',
  MEGAMENU_BINDING_ALREADY_EXISTS: 'MEGAMENU_BINDING_ALREADY_EXISTS',
  MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE: 'MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE',
  MEGAMENU_TARGET_OUT_OF_SCOPE: 'MEGAMENU_TARGET_OUT_OF_SCOPE',
  MEGAMENU_ASSET_KIND_MISMATCH: 'MEGAMENU_ASSET_KIND_MISMATCH',
  MEGAMENU_REFERENCED: 'MEGAMENU_REFERENCED',
  MEGAMENU_DEPTH_EXCEEDED: 'MEGAMENU_DEPTH_EXCEEDED',

  // Blog (feature 016)
  BLOG_SLUG_INVALID: 'BLOG_SLUG_INVALID',
  BLOG_SLUG_TAKEN: 'BLOG_SLUG_TAKEN',
  BLOG_POST_NOT_FOUND: 'BLOG_POST_NOT_FOUND',
  BLOG_POST_NO_CHANNEL: 'BLOG_POST_NO_CHANNEL',
  BLOG_POST_NO_LANGUAGE: 'BLOG_POST_NO_LANGUAGE',
  BLOG_CATEGORY_NOT_FOUND: 'BLOG_CATEGORY_NOT_FOUND',
  BLOG_CATEGORY_NO_CHANNEL: 'BLOG_CATEGORY_NO_CHANNEL',
  BLOG_CATEGORY_CYCLE: 'BLOG_CATEGORY_CYCLE',
  BLOG_CATEGORY_PROTECTED: 'BLOG_CATEGORY_PROTECTED',
  BLOG_CATEGORY_IN_USE: 'BLOG_CATEGORY_IN_USE',
  BLOG_CATEGORY_HAS_CHILDREN: 'BLOG_CATEGORY_HAS_CHILDREN',
  BLOG_TAG_NOT_FOUND: 'BLOG_TAG_NOT_FOUND',
  BLOG_TAG_CODE_TAKEN: 'BLOG_TAG_CODE_TAKEN',
  BLOG_TAG_IN_USE: 'BLOG_TAG_IN_USE',
  BLOG_URL_PREFIX_INVALID: 'BLOG_URL_PREFIX_INVALID',
  BLOG_URL_PREFIX_RESERVED: 'BLOG_URL_PREFIX_RESERVED',
  BLOG_DISABLED: 'BLOG_DISABLED',
  BLOG_ASSET_KIND_MISMATCH: 'BLOG_ASSET_KIND_MISMATCH',
  BLOG_RELATED_POST_SELF_REFERENCE: 'BLOG_RELATED_POST_SELF_REFERENCE',

  // Admin (feature 016 — extends 003)
  ADMIN_ROLE_PROTECTED: 'ADMIN_ROLE_PROTECTED',

  // Dictionary (feature 017)
  DICTIONARY_ENTRY_NOT_FOUND: 'DICTIONARY_ENTRY_NOT_FOUND',
  DICTIONARY_ENTRY_INACTIVE: 'DICTIONARY_ENTRY_INACTIVE',
  DICTIONARY_ENTRY_HAS_DEPENDENTS: 'DICTIONARY_ENTRY_HAS_DEPENDENTS',
  DICTIONARY_LAST_ACTIVE_ENTRY: 'DICTIONARY_LAST_ACTIVE_ENTRY',
  DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED',
  DICTIONARY_FALLBACK_CYCLE: 'DICTIONARY_FALLBACK_CYCLE',
  DICTIONARY_CODE_IMMUTABLE: 'DICTIONARY_CODE_IMMUTABLE',
  DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE: 'DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE',

  // Module Lifecycle (feature 018)
  MODULE_DISABLED: 'MODULE_DISABLED',

  // Module Lifecycle (feature 073 — operator activation)
  /** No manifest and no registry row answer to this module id. */
  MODULE_NOT_FOUND: 'MODULE_NOT_FOUND',
  /**
   * The module declared itself non-deactivatable, or declares no activation
   * control at all — either way there is nothing an operator may switch.
   */
  MODULE_NOT_DEACTIVATABLE: 'MODULE_NOT_DEACTIVATABLE',
  /**
   * An ordinary settings write targeted a module's activation control. The
   * audited `module.activation.set` Command is the only door (FR-007, FR-009).
   */
  MODULE_ACTIVATION_PROTECTED: 'MODULE_ACTIVATION_PROTECTED',
  /**
   * Deactivating a module other effectively-present modules depend on
   * (FR-008). Distinct from `MODULE_NOT_DEACTIVATABLE`, which says there is
   * nothing to switch *ever*: this one is a "not in this order" with a remedy —
   * `details.blockedBy` names the modules to switch off first.
   */
  MODULE_DEPENDENTS_PRESENT: 'MODULE_DEPENDENTS_PRESENT',
  /**
   * Activating a module whose own dependencies are not effectively present
   * (FR-008, the symmetric direction). `details.missing` names them.
   */
  MODULE_DEPENDENCIES_ABSENT: 'MODULE_DEPENDENCIES_ABSENT',
  /**
   * A configuration write targeted a module that is not effectively present.
   * Reads still show the stored value; writes are refused (FR-033).
   */
  MODULE_SETTING_READ_ONLY: 'MODULE_SETTING_READ_ONLY',

  // Transactional Emails (issue #89 — per-email operator activation)
  /**
   * The owning module declared this individual email non-deactivatable —
   * it is required to create an account or to get back into one. Deliberately
   * the twin of `MODULE_NOT_DEACTIVATABLE`, one granularity down: same 409,
   * same "there is nothing here to switch, ever", same carried reason.
   */
  TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE: 'TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE',

  // Catalog (feature 022 — Products Bulk Edit)
  BULK_TOO_LARGE: 'BULK_TOO_LARGE',
  ATTRIBUTE_NOT_MASS_EDITABLE: 'ATTRIBUTE_NOT_MASS_EDITABLE',

  // Catalog (feature 033 — Products collection selection)
  SELECTION_TOO_LARGE: 'SELECTION_TOO_LARGE',

  // MFA (feature 042)
  MFA_INVALID_CODE: 'MFA_INVALID_CODE',
  MFA_INVALID_CHALLENGE: 'MFA_INVALID_CHALLENGE',
  MFA_TOO_MANY_ATTEMPTS: 'MFA_TOO_MANY_ATTEMPTS',
  MFA_WRONG_SURFACE: 'MFA_WRONG_SURFACE',
  MFA_ALREADY_ENROLLED: 'MFA_ALREADY_ENROLLED',
  MFA_NO_PENDING_ENROLMENT: 'MFA_NO_PENDING_ENROLMENT',
  MFA_NO_ACTIVE_ENROLMENT: 'MFA_NO_ACTIVE_ENROLMENT',
  MFA_REAUTH_REQUIRED: 'MFA_REAUTH_REQUIRED',
  MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
  // Issue #194 — unlinking a federated identity that is the account's only
  // credential is refused: an account created by a social sign-in holds a
  // random password nobody knows, so the link is the way back in.
  MFA_SOCIAL_LAST_CREDENTIAL: 'MFA_SOCIAL_LAST_CREDENTIAL',
  // Feature 055 — Custom Fields Layer.
  CUSTOM_FIELD_NOT_FOUND: 'CUSTOM_FIELD_NOT_FOUND',
  CUSTOM_FIELD_KEY_CONFLICT: 'CUSTOM_FIELD_KEY_CONFLICT',
  CUSTOM_FIELD_DEFINITION_INVALID: 'CUSTOM_FIELD_DEFINITION_INVALID',
  CUSTOM_FIELD_VALUE_INVALID: 'CUSTOM_FIELD_VALUE_INVALID',
  // Feature 061 — the entity type's registry entry declares `managedBy`, so
  // definitions are mutated only through the owning host module's surface
  // (generic admin mutations refuse with 409 "host_managed").
  CUSTOM_FIELD_HOST_MANAGED: 'CUSTOM_FIELD_HOST_MANAGED',

  // Feature 058 — Credentials (reusable credential configurations).
  CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
  CREDENTIAL_CODE_TAKEN: 'CREDENTIAL_CODE_TAKEN',
  CREDENTIAL_TYPE_UNKNOWN: 'CREDENTIAL_TYPE_UNKNOWN',
  CREDENTIAL_VALIDATION_FAILED: 'CREDENTIAL_VALIDATION_FAILED',
  CREDENTIAL_IN_USE: 'CREDENTIAL_IN_USE',
  CREDENTIAL_TYPE_IMMUTABLE: 'CREDENTIAL_TYPE_IMMUTABLE',

  // Feature 059 — KSeF (Krajowy System e-Faktur integration).
  KSEF_NOT_CONFIGURED: 'KSEF_NOT_CONFIGURED',
  KSEF_UNAVAILABLE: 'KSEF_UNAVAILABLE',
  KSEF_CREDENTIAL_INVALID: 'KSEF_CREDENTIAL_INVALID',
  KSEF_CREDENTIAL_EXISTS: 'KSEF_CREDENTIAL_EXISTS',
  KSEF_ENROLLMENT_REJECTED: 'KSEF_ENROLLMENT_REJECTED',
  KSEF_ALREADY_SUBMITTED: 'KSEF_ALREADY_SUBMITTED',
  KSEF_NOT_SUBMITTABLE: 'KSEF_NOT_SUBMITTABLE',

  // Product Feed module (feature 067). The module's own operator-facing reason
  // strings live in `PRODUCT_FEED_ERROR_CODES` (product-feeds.ts) and travel in
  // the envelope's `details.reason`; these are the transport-level codes.
  PRODUCT_FEED_DISABLED: 'PRODUCT_FEED_DISABLED',
  PRODUCT_FEED_TEMPLATE_UNBOUND: 'PRODUCT_FEED_TEMPLATE_UNBOUND',
  /**
   * A template write refused on a state the operator can see and act on: it is
   * a system template, it is still used by a feed, or its name is taken.
   * `details.reason` carries which one, from `PRODUCT_FEED_ERROR_CODES`.
   */
  PRODUCT_FEED_TEMPLATE_CONFLICT: 'PRODUCT_FEED_TEMPLATE_CONFLICT',
  /**
   * The write is understood, allowed and refused only until the operator has
   * seen its consequence — removing a field the provider's shipped template
   * marks required (FR-074). It is deliberately neither a validation failure
   * (the request is valid) nor a hard block (re-sending with
   * `?acknowledgeWarnings=true` performs it); `details.warnings` carries what
   * the operator has to be told first.
   */
  PRODUCT_FEED_CONFIRMATION_REQUIRED: 'PRODUCT_FEED_CONFIRMATION_REQUIRED',
  /**
   * A taxonomy revision write refused on a state the operator can see and act
   * on: the mechanism is switched off, a check for that provider is already
   * running, the impact figure they acknowledged no longer matches, or the
   * revision is already the one in force. `details.reason` carries which one,
   * from `PRODUCT_FEED_ERROR_CODES` (feature 067, FR-087, FR-095, FR-096).
   */
  PRODUCT_FEED_TAXONOMY_CONFLICT: 'PRODUCT_FEED_TAXONOMY_CONFLICT',

  // Ergonode PIM integration (feature 068). Transport-level codes for the
  // module's admin surface — see specs/068-ergonode-pim-sync/contracts/admin-api.md.
  /** No connection row exists yet, so there is nothing to read or import from. */
  PIM_ERGONODE_NOT_CONFIGURED: 'PIM_ERGONODE_NOT_CONFIGURED',
  /** A second *enabled* connection was attempted (FR-004). */
  PIM_ERGONODE_CONNECTION_EXISTS: 'PIM_ERGONODE_CONNECTION_EXISTS',
  /** Cron supplied without its timezone (or the other way round), or an unknown IANA zone. */
  PIM_ERGONODE_SCHEDULE_INVALID: 'PIM_ERGONODE_SCHEDULE_INVALID',
  /** Enabling a connection or triggering an import without a selected category tree (FR-033). */
  PIM_ERGONODE_TREE_REQUIRED: 'PIM_ERGONODE_TREE_REQUIRED',
  /** The overlap claim is held by a run already in flight (FR-006). */
  PIM_ERGONODE_IMPORT_ALREADY_RUNNING: 'PIM_ERGONODE_IMPORT_ALREADY_RUNNING',
  PIM_ERGONODE_CONNECTION_DISABLED: 'PIM_ERGONODE_CONNECTION_DISABLED',
  /** The chosen Endora attribute cannot represent that source type; `details[]` lists what can (FR-026). */
  PIM_ERGONODE_TYPE_INCOMPATIBLE: 'PIM_ERGONODE_TYPE_INCOMPATIBLE',
  PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND: 'PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND',
  /** Another source attribute or category already binds that Endora target. */
  PIM_ERGONODE_TARGET_ALREADY_MAPPED: 'PIM_ERGONODE_TARGET_ALREADY_MAPPED',
  /** A price binding named a currency that is not active; `details[]` lists the active codes (FR-061). */
  PIM_ERGONODE_CURRENCY_INACTIVE: 'PIM_ERGONODE_CURRENCY_INACTIVE',
  PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE: 'PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE',
  PIM_ERGONODE_BINDING_EXISTS: 'PIM_ERGONODE_BINDING_EXISTS',
  /**
   * A price binding named a price list that does not exist. Named after the
   * resource rather than the module (admin-api.md § Price bindings): the caller
   * supplied a `priceListId`, and a bare `NOT_FOUND` on a request carrying three
   * identifiers says nothing about which one was wrong.
   */
  PRICE_LIST_NOT_FOUND: 'PRICE_LIST_NOT_FOUND',
  /** A protected field path does not match the grammar (data-model.md §8). */
  PIM_ERGONODE_FIELD_PATH_INVALID: 'PIM_ERGONODE_FIELD_PATH_INVALID',

  // Pimcore PIM integration (feature 076). Transport-level codes for the
  // module's admin surface — see specs/076-pimcore-pim-sync/contracts/admin-api.md.
  /** No connection row exists yet, so there is nothing to read or import from. */
  PIM_PIMCORE_NOT_CONFIGURED: 'PIM_PIMCORE_NOT_CONFIGURED',
  /** A second *enabled* connection was attempted (FR-004). */
  PIM_PIMCORE_CONNECTION_EXISTS: 'PIM_PIMCORE_CONNECTION_EXISTS',
  /** Another PIM module already has an enabled connection (FR-075). */
  PIM_PIMCORE_OTHER_PIM_ENABLED: 'PIM_PIMCORE_OTHER_PIM_ENABLED',
  /** Enabling a connection or triggering an import without a category root (FR-043). */
  PIM_PIMCORE_ROOT_REQUIRED: 'PIM_PIMCORE_ROOT_REQUIRED',
  /** Enabling a connection without a product folder (FR-093). */
  PIM_PIMCORE_PRODUCT_FOLDER_REQUIRED: 'PIM_PIMCORE_PRODUCT_FOLDER_REQUIRED',
  /** Media host allowlist entry failed validation (FR-060). */
  PIM_PIMCORE_ALLOWLIST_INVALID: 'PIM_PIMCORE_ALLOWLIST_INVALID',
  /** The overlap claim is held by a run already in flight (FR-006). */
  PIM_PIMCORE_IMPORT_ALREADY_RUNNING: 'PIM_PIMCORE_IMPORT_ALREADY_RUNNING',
  PIM_PIMCORE_CONNECTION_DISABLED: 'PIM_PIMCORE_CONNECTION_DISABLED',

  // Payments — the buyer's retry refusals (!1159). Three codes and not one,
  // because the money term and the lifecycle term are orthogonal rather than
  // alternative: an order can be unpaid and cancelled, or paid and open, so
  // neither implies the other and a cancelled-but-unpaid buyer told "there is
  // nothing to pay" is told something false.
  /** The order owes nothing — already paid, deferred to credit, or refunded. */
  PAYMENT_NOT_DUE: 'PAYMENT_NOT_DUE',
  /** The order's lifecycle is over, so no payment can be started against it. */
  PAYMENT_ORDER_CLOSED: 'PAYMENT_ORDER_CLOSED',
  /**
   * The money is still owed and the order is open; the shop cannot start a
   * session because the method it was placed with is gone. Named for the
   * adapter and not the method, because `PAYMENT_METHOD_*` is the family
   * `payment_methods` would reach for and D-182 routes a contested code to
   * neither claimant.
   */
  PAYMENT_ADAPTER_UNAVAILABLE: 'PAYMENT_ADAPTER_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * The shape of every error code on the wire — the platform's own and a
 * module's alike (`specs/090-module-owned-error-codes/`, `contracts/error-code-declaration.md` §1.1).
 *
 * SCREAMING_SNAKE_CASE, and it is the one grammar three separate things agree
 * on: `ERROR_CODES`' own members, a module's `errorCodes` manifest declaration,
 * and the `errors.<CODE>` key the sentence is written under.
 */
export const errorCodeRe = /^[A-Z][A-Z0-9_]*$/;

declare const moduleErrorCodeBrand: unique symbol;

/**
 * An error code declared by a module rather than enumerated by the platform.
 *
 * `ERROR_CODES` stays closed and stays the vocabulary of the codes **this
 * repository's** modules declare (`error-code-declaration.md` §5). A module
 * written outside this repository has no way into it, so its codes need a type
 * of their own — and D-182's amendment of 2026-08-28 rules that the type is
 * **branded**, produced only by {@link defineModuleErrorCodes}:
 *
 * > *"the stranger gets the protection our own core modules already have: a typo
 * > at a raise site is a compile error rather than a code that travels the whole
 * > path and renders raw to an operator with nothing reporting it."*
 *
 * **What the brand buys, exactly**, because it is easy to over-read. It bites on
 * *assignability*: a bare `'ACME_TYPO'` is assignable to neither `ErrorCode` nor
 * this type, so `new HttpError(400, 'ACME_TYPO', …)` does not compile. It does
 * **not** bite on *comparability*, which is the `===` at a reading site —
 * measured on TypeScript 5.9: with `code: ErrorCode | ModuleErrorCode`, both
 * `code === 'ACME_TYPO'` and `code === 'PRDUCT_NOT_FOUND'` compile, where the
 * second is a type error today against the closed enumeration. That is the cost
 * `research.md` §7 records and `plan.md` Q3 leaves open; the brand does not pay
 * it. And it says nothing at all about a code declared and never translated
 * (the reconciliation) or about two modules claiming one code (the collision
 * rule) — two things the same amendment is careful to spell out.
 */
export type ModuleErrorCode = string & {
  readonly [moduleErrorCodeBrand]: 'module-error-code';
};

/**
 * The authoring shape for a module's own error codes.
 *
 * ```ts
 * export const acmeErrorCodes = defineModuleErrorCodes([
 *   'ACME_SYNC_NOT_CONFIGURED',
 *   'ACME_SYNC_REJECTED',
 * ]);
 *
 * throw new HttpError(409, acmeErrorCodes.ACME_SYNC_REJECTED, 'Sync rejected.');
 * ```
 *
 * The returned object's keys are the codes, so a typo at a raise site is a
 * property that does not exist; its values carry the brand, so a bare string
 * literal cannot stand in for one. Declaring the code in the manifest
 * (`errorCodes: [{ code: 'ACME_SYNC_REJECTED' }]`) is a separate act and remains
 * what routes the sentence — this helper decides nothing about routing.
 *
 * Two refusals, both at import time on the author's own machine, neither needing
 * an instance: a code that is not SCREAMING_SNAKE_CASE, and the same code twice.
 * The second matters because the return value is an object, where a duplicate
 * collapses silently into one key.
 */
export function defineModuleErrorCodes<const Codes extends readonly string[]>(
  codes: Codes,
): { readonly [Code in Codes[number]]: ModuleErrorCode } {
  const seen = new Set<string>();
  const declared: Record<string, string> = {};
  for (const code of codes) {
    if (!errorCodeRe.test(code)) {
      throw new Error(
        `[contracts/errors] "${code}" is not a valid error code — it must match ` +
          `${String(errorCodeRe)} (SCREAMING_SNAKE_CASE).`,
      );
    }
    if (seen.has(code)) {
      throw new Error(
        `[contracts/errors] error code "${code}" is declared twice — the codes ` +
          'become object keys, so the duplicate would collapse into one silently.',
      );
    }
    seen.add(code);
    declared[code] = code;
  }
  return declared as { readonly [Code in Codes[number]]: ModuleErrorCode };
}

export const errorDetailSchema = z.object({
  path: z.string().describe('dot-path to the offending field inside the request body or query'),
  issue: z.string().describe('human-readable explanation of what failed'),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    // Relaxed from `z.enum(Object.values(ERROR_CODES))` by feature 090
    // (`contracts/error-code-declaration.md` §5): a module declares its own
    // codes, so the wire's vocabulary is no longer the platform's enumeration.
    // Every envelope valid before is valid after — this widens and never
    // narrows — and the change is inert at runtime: the schema's only consumers
    // in the tree are the `z.infer` below and one documentation reference, so no
    // request or response validation moves.
    //
    // The `refine` carries no runtime decision (the regex above is the whole
    // check); it is there to state the **output type**, which is the union and
    // not a bare `string`. Losing that would relax `ErrorEnvelope` further than
    // the feature asks for, and it is the type both applications read.
    code: z
      .string()
      .regex(errorCodeRe)
      .refine((value): value is ErrorCode | ModuleErrorCode => errorCodeRe.test(value)),
    message: z.string(),
    // Two shapes: (a) the legacy Zod-style array of {path, issue}, used by
    // request-validation failures, and (b) a free-form object used by
    // domain errors that carry structured metadata (e.g. feature 022's
    // `BULK_TOO_LARGE` envelope carries `{ maxBatchSize, recommendedSplitInto }`).
    details: z.union([z.array(errorDetailSchema), z.record(z.string(), z.unknown())]).optional(),
    requestId: z.string().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * `MODULE_DISABLED` names the module it refused for (issue #161).
 *
 * The refusal is raised in one place — the kernel's `ModuleDisabledError` — and
 * carried the module id on the error object only. The envelope replaces an
 * operator-visible message with the registered sentence for its **code**, and
 * `MODULE_DISABLED` is one code for every gated port in the platform, so the
 * wire carried "Module Disabled." and the one fact the operator needs to act —
 * which module to look at — never left the process. It is published here rather
 * than left implicit because it is a wire shape: a client may read it, and the
 * sentence interpolates `{module}` out of it.
 */
export const moduleDisabledDetailsSchema = z.object({
  /** Manifest id of the module whose effective state refused the call. */
  module: z.string().min(1),
});

export type ModuleDisabledDetails = z.infer<typeof moduleDisabledDetailsSchema>;
