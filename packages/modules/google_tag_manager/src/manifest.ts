import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { GOOGLE_TAG_MANAGER_SETTING_CODES } from '@endora-commerce/contracts';

/**
 * Google Tag Manager module (feature 066). Puts the operator's GTM container on
 * the storefront per sales channel, publishes a documented commerce `dataLayer`
 * vocabulary for their tags to trigger on, and optionally relays the
 * relay-eligible subset of those events to their server-side container.
 *
 * The module owns no table and no admin page: every tag, trigger and variable
 * lives in the GTM console, and the six values below are managed on the generic
 * Settings screen (research §§R2-R3). Consequently it declares no permission
 * codes — the one palette action references the core `settings:read` code.
 */
export const googleTagManagerSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'google_tag_manager',
  groups: [{ code: 'google_tag_manager', name: 'Google Tag Manager' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide, and
      // deliberately not `google_tag_manager.enabled`: that code already exists
      // and is per-sales-channel, answering "does the container load on this
      // storefront". This one answers "does this client have GTM at all".
      code: 'google_tag_manager.module_enabled',
      name: 'Google Tag Manager module enabled',
      description:
        'Switches the Google Tag Manager container injection and the server-side relay on or off for the whole platform. Separate from the per-channel switch, which decides where the container actually loads. Nothing is dropped: every setting keeps its value.',
      groupCode: 'google_tag_manager',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.ENABLED,
      name: 'Enable Google Tag Manager',
      description:
        'Master switch for the module. Per-channel overridable. If your container also contains a GA4 tag, do not enable the platform\'s Google Analytics module for the same channel: both would report the same actions and every metric would be doubled.',
      groupCode: 'google_tag_manager',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID,
      name: 'Container ID',
      description:
        'GTM container ID (GTM-XXXXXXX) from the Google Tag Manager console. Blank means the channel is untracked.',
      groupCode: 'google_tag_manager',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.REQUIRE_CONSENT,
      name: 'Require analytics consent',
      description:
        'When enabled, the container starts with Consent Mode v2 set to denied and the platform sends no events until the visitor accepts the cookie banner. Consent Mode governs Google tags automatically; a non-Google tag in your container fires unless you add an additional consent check to it.',
      groupCode: 'google_tag_manager',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_SIDE_ENABLED,
      name: 'Server-side tagging',
      description:
        'Deliver the platform\'s commerce events to your server-side GTM container from the backend instead of the browser. This moves those events out of the web container: tags that trigger on them must exist in the server container. Triggers configured inside the web container (scroll, clicks, visibility, forms) are unaffected.',
      groupCode: 'google_tag_manager',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_CONTAINER_URL,
      name: 'Server container URL',
      description:
        'Base URL of your server-side GTM container, e.g. https://sgtm.example.com. Blank keeps the channel on the browser path even when server-side tagging is on.',
      groupCode: 'google_tag_manager',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_INGEST_PATH,
      name: 'Server container ingest path',
      description:
        "Request path your server container's client listens on. Default /data matches Google's Data Client; change it only if your container uses a custom client.",
      groupCode: 'google_tag_manager',
      valueType: 'string',
      defaultValue: '/data',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'google_tag_manager',
  name: 'Google Tag Manager',
  description:
    'Google Tag Manager integration: per-sales-channel container injection behind the storefront consent decision, a documented commerce dataLayer vocabulary, and an optional server-side tagging relay.',
  version: '1.0.0',
  dependencies: ['sales_channels', 'settings'],
  settings: googleTagManagerSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  actions: [
    {
      id: 'open-google-tag-manager',
      labelKey: 'actions.openGoogleTagManager.label',
      descriptionKey: 'actions.openGoogleTagManager.description',
      icon: 'Settings',
      // The module has no page of its own — its settings group lives on the
      // generic Settings screen, which has a search box (research §R3).
      targetRoute: '/settings',
      // Core catalogue code, referenced rather than re-declared: this module
      // owns no permission of its own.
      requiredPermission: 'settings:read',
      keywords: [
        'gtm',
        'google',
        'tag',
        'manager',
        'container',
        'datalayer',
        'sgtm',
        'tagi',
        'kontener',
      ],
      weight: 246,
    },
  ],
  activation: { settingCode: 'google_tag_manager.module_enabled', default: true },
});
