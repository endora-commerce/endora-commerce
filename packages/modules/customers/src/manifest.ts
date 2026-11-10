import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type CustomFieldWriteDeclaration,
} from '@endora-commerce/contracts';

/**
 * Customers (Klienci) module — feature 040.
 *
 * Owns the customer-lifecycle business logic and the admin + storefront
 * surfaces on top of the `customer_accounts` data module: standalone
 * registration, self-service (defaults, history), and admin
 * oversight (block/unblock, impersonation, detail view, customer groups,
 * password reset, soft-delete + restore, online presence).
 *
 * Three platform-wide settings are registered here and seeded by the
 * module-lifecycle ManifestReconciler on boot.
 */

export const CUSTOMERS_SETTING_CODES = {
  /** Gate standalone (org-less) registration (FR-001/FR-004). */
  ALLOW_REGISTRATION_WITHOUT_ORGANIZATION:
    'customers.allow_registration_without_organization',
  /** Restore window (days) before permanent anonymization (FR-041). */
  DELETION_RETENTION_DAYS: 'customers.deletion_retention_days',
  /** "Online" threshold (minutes) for the admin presence view. */
  PRESENCE_FRESHNESS_MINUTES: 'customers.presence_freshness_minutes',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'customers',
  groups: [{ code: 'customers', name: 'Customers' }],
  settings: [
    {
      code: CUSTOMERS_SETTING_CODES.ALLOW_REGISTRATION_WITHOUT_ORGANIZATION,
      name: 'Allow registration without organization',
      description:
        'When enabled, visitors may register a standalone Customer account that is not attached to any Organization. When disabled, registration requires Organization context.',
      groupCode: 'customers',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS,
      name: 'Customer deletion retention window (days)',
      description:
        'Number of days a deleted Customer account can be restored before its personal data is permanently anonymized. Default 365 (1 year).',
      groupCode: 'customers',
      valueType: 'number',
      defaultValue: 365,
    },
    {
      code: CUSTOMERS_SETTING_CODES.PRESENCE_FRESHNESS_MINUTES,
      name: 'Online customers freshness (minutes)',
      description:
        'A Customer counts as "online" if their session was active within this many minutes. Default 10.',
      groupCode: 'customers',
      valueType: 'number',
      defaultValue: 10,
    },
  ],
});

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` research R-11) — the
 * admin write of the `customer` host's values this module serves, for
 * `check:custom-field-writes`. The `customer` create is `organizations`'
 * (member direct-create) and is declared there. Read as a literal by the
 * check: keep every entry a literal object.
 */
export const customFieldWrites = [
  {
    entityType: 'customer',
    kind: 'values',
    method: 'PATCH',
    path: '/api/v1/admin/customers/:id/custom-fields',
    body: 'customFieldValuesSchema',
  },
] satisfies CustomFieldWriteDeclaration[];

export const manifest = defineModuleManifest({
  id: 'customers',
  name: 'Customers',
  description:
    'Customer lifecycle business logic: registration, self-service, blocking, impersonation, groups, deletion, and presence.',
  version: '1.0.0',
  // Feature 072 (T140) — the edges the module actually resolves. `auth`
  // (sessions), `email` (the set-password mail), `quote_requests` (the RFQ
  // history surface) and `custom_fields` were all reached through options a
  // root passed down, which is why none of them appeared here.
  // Feature 073 (Constitution XVII) — the operator's activation control. This
  // is the *management* surface over customer accounts: the admin CRM screens,
  // moderation, self-service profile and deletion. The accounts themselves live
  // in `customer_accounts`, which is non-deactivatable, so switching this off
  // removes screens and self-service rather than the ability to log in.
  activation: { settingCode: 'customers.enabled', default: true },
  //
  // Issue #216 adds `quick_order`: the customer-detail screen and the
  // self-service profile render and edit a buyer's default payment and
  // delivery method, and those live in `quick_order`'s preference store. This
  // module used to build a second instance of that module's service instead of
  // resolving the port published for it, so the edge existed and was declared
  // nowhere. Binding rather than `degrades-without`, because that is what
  // `DefaultPreferencePort`'s contract says its seam does when the owner is
  // off, and because a half-written set of ordering defaults is worse than a
  // refusal.
  //
  // Feature 075's Phase-C cut adds `addresses`: the admin address card lists
  // the buyer's **organisation's** addresses, and this module used to query
  // that module's table itself. It reads `addressReadPort` now — and, since
  // `specs/173-b2c-address-book-merge/`, writes through `addressServicePort`:
  // the release-1 job moves B2C personal-book rows into the personal
  // Organization's book, and the retention sweep anonymizes that book. Binding,
  // and unremarkably so — `addresses` is non-deactivatable, so the edge has no
  // absent state to declare a degrade for.
  //
  // Feature 075's cut adds three more, each replacing a second instance this
  // module built from an import of the owner's directory or a query against its
  // table: `admin_users` (the impersonation seam behind the "view as this
  // customer" control), `carts` (the reporting read behind the customer-detail
  // cart panel) and `orders` (the list behind both order-history panels).
  //
  // All three are binding, and unremarkably so: every one of them declares
  // `nonDeactivatable`, so none has an absent state for a degrade to describe.
  // The `orders` edge in particular used to be a `degrades-without` whose
  // reason argued that declaring it "would make `orders` undeactivatable" — a
  // sentence about a module that has never had an activation control, kept
  // alive by a presence probe that could not fire. It is a declared dependency
  // now, and the panels read the gated port directly.
  dependencies: [
    // `_i18n` owns `adminI18nService`, through which global search's Customer
    // provider labels a status in the admin's language
    // (`specs/150-admin-global-search/`).
    '_i18n',
    'addresses',
    // `specs/117-instance-bring-up/` Phase 6 — `customerModerationActorResolver`
    // is this module's own since FR-033, and it reads the moderating admin's
    // role through `adminRolePort` beside the `adminUserReadPort` already
    // declared below. The production root asked the same question in
    // `knex.raw` over both tables; a port needs the edge and the SQL never
    // declared one. `admin_roles` declares `activation.nonDeactivatable`, so
    // the edge costs no operator an activation control.
    'admin_roles',
    'admin_users',
    'auth',
    'carts',
    'custom_fields',
    'customer_accounts',
    'email',
    'orders',
    'organizations',
    'quick_order',
    'quote_requests',
    'settings',
  ],
  nonBindingDependencies: [
    {
      moduleId: 'admin_search',
      name: 'adminSearchProviderRegistry',
      kind: 'contributes-to',
      reason:
        'A push, from this module’s contribution-only boot hook, of the Customer provider for the ' +
        'admin global search, built over the customer list’s own search and scope. Nothing is read ' +
        'back: the registry enumerates only providers whose module is effectively present, so an ' +
        'absent contributor costs the host nothing and an absent host holds a table nobody walks. ' +
        'Not `dependencies`: that would make global search a reason this module cannot be switched off.',
    },
  ],
  settings,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * Two codes this module raises.
   *
   * **`CUSTOMER_ADDRESS_BOOK_RETIRED`** (`specs/173-b2c-address-book-merge/`
   * release 1, OD-8) — every former personal-address-book endpoint answers
   * `410 Gone` with it, for every caller. Its sentence is in this module's
   * bundle, in both languages (`errors.CUSTOMER_ADDRESS_BOOK_RETIRED`). It
   * replaced `CUSTOMER_ADDRESS_NOT_FOUND`, which nothing raises any more, and
   * goes itself in release 2, with the stub routes.
   *
   * **`REGISTRATION_REQUIRES_ORGANIZATION` is T2, not T1** (D-129's sweep,
   * `specs/090-module-owned-error-codes/d129-sweep.md`). Its noun is a
   * registration and an Organization, and `organizations` owns the second — so
   * T1 has two claimants and does not decide it. T2 does: the code names a
   * *mechanism*, the storefront's standalone self-registration path, which
   * this module implements in `customer-registration-service.ts` and is the
   * only thing in the tree that raises. It has no sentence in either language
   * and stays on `UNTRANSLATED_ERROR_CODES`; the storefront's registration page
   * carries its own copy for the refusal.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: both raises are a bare
   * `HttpError(status, code, message)` with no `details`.
   */
  errorCodes: [
    { code: 'CUSTOMER_ADDRESS_BOOK_RETIRED' },
    { code: 'REGISTRATION_REQUIRES_ORGANIZATION' },
  ],
  actions: [
    {
      id: 'open-customers',
      labelKey: 'actions.openCustomers.label',
      descriptionKey: 'actions.openCustomers.description',
      icon: 'Users',
      targetRoute: '/customers',
      requiredPermission: 'customers:read',
      keywords: ['customers', 'clients'],
      keywordsKey: 'actions.openCustomers.keywords',
      weight: 210,
    },
    {
      id: 'online-customers',
      labelKey: 'actions.onlineCustomers.label',
      descriptionKey: 'actions.onlineCustomers.description',
      icon: 'Users',
      targetRoute: '/customers/online',
      requiredPermission: 'customers:read',
      keywords: ['online', 'presence'],
      keywordsKey: 'actions.onlineCustomers.keywords',
      weight: 205,
    },
  ],
});
