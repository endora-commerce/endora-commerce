import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

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
  dependencies: [
    'auth',
    'custom_fields',
    'customer_accounts',
    'email',
    'organizations',
    'quote_requests',
    'settings',
  ],
  settings,
  i18n: { bundlesDir: 'i18n' },
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
