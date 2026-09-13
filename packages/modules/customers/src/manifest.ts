import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Customers (Klienci) module — feature 040.
 *
 * Owns the customer-lifecycle business logic and the admin + storefront
 * surfaces on top of the `customer_accounts` data module: standalone
 * registration, self-service (addresses, defaults, history), and admin
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
  // Feature 075's Phase-C cut adds `addresses`: the self-service and admin
  // address panels list the buyer's **organisation's** shared addresses beside
  // their personal ones, and this module used to query that module's table
  // itself. It reads `addressReadPort` now. Binding, and unremarkably so —
  // `addresses` is non-deactivatable, so the edge has no absent state to
  // declare a degrade for.
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
  settings,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * Two codes from the platform block — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * Both were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain
   * had no rule for them and its last line was `return 'core'`.
   *
   * **`CUSTOMER_ADDRESS_NOT_FOUND` is here and the four `CUSTOMER_*` record
   * codes are not, and that split is a ruling rather than a reading.** D-186
   * §1 (`specs/080-f4-real-scope/rulings.md`) settles the noun "customer":
   * `customer_accounts` owns the **record**, this module owns
   * **`CustomerAddress`**. So `CUSTOMER_NOT_FOUND`,
   * `CUSTOMER_ALREADY_DELETED`, `CUSTOMER_NOT_DELETED` and
   * `CUSTOMER_RESTORE_WINDOW_ELAPSED` go to `customer_accounts` in a later
   * batch — two of them raised from *this* module, which is the consequence
   * the ruling accepts in terms and the shape D-95.2 already ruled for
   * `INVOICE_NOT_READY`: the owner of a noun is not required to be the module
   * that throws about it. The prefix is the same in all five; the noun is not,
   * and the noun is what decides.
   *
   * **`REGISTRATION_REQUIRES_ORGANIZATION` is T2, not T1.** Its noun is a
   * registration and an Organization, and `organizations` owns the second — so
   * T1 has two claimants and does not decide it. T2 does: the code names a
   * *mechanism*, the storefront's standalone self-registration path, which
   * this module implements in `customer-registration-service.ts` and is the
   * only thing in the tree that raises. What it refuses is this module's own
   * setting being off, not a judgement `organizations` makes.
   *
   * **No sentence moves with them.** Neither has a sentence in either language
   * anywhere in the tree; both were already on `UNTRANSLATED_ERROR_CODES`
   * under `_i18n` and move to this module's group there, so the bundle this
   * module already ships gains no key. The storefront's registration page
   * carries its own copy for the refusal
   * (`storefront/app/(auth)/register-customer/page.tsx`), which is a surface
   * string and not the envelope's sentence.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: both raises are a bare
   * `HttpError(status, code, message)` with no `details`.
   */
  errorCodes: [
    { code: 'CUSTOMER_ADDRESS_NOT_FOUND' },
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
      keywords: ['customers', 'clients', 'klienci', 'klient'],
      weight: 210,
    },
    {
      id: 'online-customers',
      labelKey: 'actions.onlineCustomers.label',
      descriptionKey: 'actions.onlineCustomers.description',
      icon: 'Users',
      targetRoute: '/customers/online',
      requiredPermission: 'customers:read',
      keywords: ['online', 'presence', 'aktywni', 'online klienci'],
      weight: 205,
    },
  ],
});
