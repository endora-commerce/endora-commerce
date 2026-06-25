import { defineModuleManifest, defineModuleSettingsManifest, PWA_PERMISSIONS, PWA_SETTING_CODES } from '@b2b/contracts';

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

const settings = defineModuleSettingsManifest({
  moduleCode: 'pwa',
  groups: [{ code: 'pwa', name: 'Progressive Web App' }],
  settings: [
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
  dependencies: ['_lifecycle', '_i18n', 'settings', 'sales_channels', 'assets_library'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: PWA_PERMISSIONS.READ, label: 'View PWA settings' },
    { code: PWA_PERMISSIONS.WRITE, label: 'Configure PWA' },
    { code: PWA_PERMISSIONS.SEND_PUSH, label: 'Send push notifications' },
  ],
});
