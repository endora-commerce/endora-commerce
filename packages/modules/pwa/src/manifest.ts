import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  PWA_PERMISSIONS,
  PWA_SETTING_CODES,
  type SettingManifestEntry,
} from '@endora-commerce/contracts';

/**
 * PWA module — feature 046.
 *
 * Adds Progressive-Web-App capabilities to the storefront and admin: home-screen
 * installability, a Settings-driven per-channel installable identity (icon, name,
 * theme), opt-in static-asset caching, a controlled service-worker update path,
 * and opt-in push notifications behind a provider-agnostic abstraction (default
 * backend: Web-Push/VAPID; FCM/OneSignal are drop-in providers).
 *
 * Configuration lives in the Settings module (group `pwa`) and resolves per Sales
 * Channel via the standard global + override chain (FR-011). VAPID private key and
 * the optional FCM service-account JSON are `secret` value types (encrypted at rest).
 */

// Every PWA setting is managed exclusively from the dedicated PWA settings
// page (/settings/pwa). Marking them `hidden: true` (applied below) keeps them
// out of the generic Settings screen so each value lives in exactly one place.
const pwaSettingEntries: SettingManifestEntry[] = [
    {
      code: PWA_SETTING_CODES.APP_NAME,
      name: 'App name',
      description: 'Installed-app name shown on the device home screen (manifest `name`).',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: 'B2B Platform',
    },
    {
      code: PWA_SETTING_CODES.SHORT_NAME,
      name: 'Short name',
      description: 'Short installed-app name used where space is constrained (manifest `short_name`).',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: 'B2B',
    },
    {
      code: PWA_SETTING_CODES.THEME_COLOR,
      name: 'Theme color',
      description: 'Hex theme color applied to the installed-app UI (manifest `theme_color`).',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: '#1d4ed8',
    },
    {
      code: PWA_SETTING_CODES.BACKGROUND_COLOR,
      name: 'Background color',
      description: 'Hex background color shown on the splash screen (manifest `background_color`).',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: '#fafafa',
    },
    {
      code: PWA_SETTING_CODES.DISPLAY_MODE,
      name: 'Display mode',
      description: "How the installed app launches: 'standalone', 'fullscreen' or 'minimal-ui'.",
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: 'standalone',
    },
    {
      code: PWA_SETTING_CODES.ICON_ASSET_ID,
      name: 'Icon source asset id',
      description: 'Assets-library id of the uploaded source icon. Empty falls back to bundled placeholder icons.',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: PWA_SETTING_CODES.CACHING_ENABLED,
      name: 'Static-asset caching enabled',
      description: 'When on, the storefront service worker caches static assets for faster repeat visits and an offline shell.',
      groupCode: 'pwa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: PWA_SETTING_CODES.PUSH_ENABLED,
      name: 'Push notifications enabled',
      description: 'When on, the storefront offers a push opt-in and the platform can deliver notifications to subscribed devices.',
      groupCode: 'pwa',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: PWA_SETTING_CODES.VAPID_PUBLIC_KEY,
      name: 'VAPID public key',
      description: 'Public VAPID key served to the storefront subscribe flow. Generated together with the private key.',
      groupCode: 'pwa',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: PWA_SETTING_CODES.VAPID_PRIVATE_KEY,
      name: 'VAPID private key',
      description: 'Private VAPID key used to sign Web-Push messages. Write-only: encrypted at rest and never returned after saving.',
      groupCode: 'pwa',
      valueType: 'secret',
      defaultValue: '',
    },
    {
      code: PWA_SETTING_CODES.FCM_SERVICE_ACCOUNT,
      name: 'FCM service account (JSON)',
      description: 'Optional Firebase service-account JSON for the token-based FCM provider. Write-only: encrypted at rest.',
      groupCode: 'pwa',
      valueType: 'secret',
      defaultValue: '',
    },
];

const settings = defineModuleSettingsManifest({
  moduleCode: 'pwa',
  groups: [{ code: 'pwa', name: 'Progressive Web App' }],
  settings: [
    ...pwaSettingEntries.map((entry) => ({ ...entry, hidden: true })),
    {
      // Feature 073 — the operator's activation control. Deliberately NOT
      // hidden: every other setting here is internal plumbing the PWA screen
      // manages, while this one is the operator's own switch and belongs on
      // `/platform/modules`.
      code: 'pwa.enabled',
      name: 'Progressive Web App enabled',
      description:
        'Switches the installable-app manifest, the push-subscription registry and push delivery on or off. Nothing is dropped: subscriptions and icons stay in the database, and pushes resume for the same subscribers when you switch it back on.',
      groupCode: 'pwa',
      valueType: 'boolean' as const,
      defaultValue: true,
    },
  ],
});

/** Settings-only export consumed by the boot-time ManifestReconciler list. */
export const pwaSettingsManifest = settings;

export const manifest = defineModuleManifest({
  id: 'pwa',
  name: 'Progressive Web App',
  description:
    'Installability, static-asset caching, controlled service-worker updates, and provider-agnostic push notifications for the storefront and admin.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  //
  // `customer_accounts` and `organizations` arrived with feature 075 Phase C:
  // the push Rule Builder's three target pickers and the rule-audience
  // expansion read rows those modules own, and they used to read them off the
  // tables directly. Both are **binding**: a picker that silently lists nothing
  // and an audience that silently resolves to nobody both read as legitimate
  // answers, so the seam fails closed. `price_lists` was the third, for
  // `customerGroupReadPort`; feature 076 (D-79) moved that port to
  // `customer_accounts`, which this module already declares, and the port check
  // confirms nothing else here resolves out of `price_lists`.
  //
  // `orders` arrived with `specs/110-instance-repository/` T118c: the FR-024
  // order-status auto-trigger reads the order it is announcing over
  // `orderReadPort`, which a composition root used to read on this module's
  // behalf inside `pwaBridge`. It is **binding**, and it costs no operator a
  // control, derived rather than waived: `orders` is `nonDeactivatable`.
  // `assets_library` and `sales_channels` are `nonDeactivatable` as well, and
  // both were already declared, so the two ports that drained beside it owe no
  // `refuses-without` sentence either. The kernel's
  // `salesChannelResolutionPort` is a platform name and puts nothing here at
  // all.
  dependencies: [
    '_i18n',
    '_lifecycle',
    'assets_library',
    'orders',
    'sales_channels',
    'settings',
    'auth',
    'customer_accounts',
    'organizations',
  ],
  settings,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [
    { code: PWA_PERMISSIONS.READ, label: 'View PWA settings' },
    { code: PWA_PERMISSIONS.WRITE, label: 'Configure PWA' },
    { code: PWA_PERMISSIONS.SEND_PUSH, label: 'Send push notifications' },
  ],
  activation: { settingCode: 'pwa.enabled', default: true },
});
