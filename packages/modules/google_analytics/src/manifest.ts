import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@endora-commerce/contracts';

/**
 * Google Analytics module (feature 049). Integrates the storefront with
 * Google Analytics 4: per-sales-channel activation + Measurement ID, Enhanced
 * Ecommerce, an optional server-side tagging delivery path (durable BullMQ
 * worker — Principle X), and an admin custom-events builder. Per-channel
 * configuration is stored through the Settings module; the Measurement Protocol
 * API secret uses the `secret` value type (feature 043, AES-256-GCM at rest).
 *
 * Distinct from the legacy `analytics` module (internal first-party event log +
 * env-gated forwarder), which this module supersedes for GA forwarding.
 */
export const googleAnalyticsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'google_analytics',
  groups: [{ code: 'google_analytics', name: 'Google Analytics' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide, and
      // deliberately not `google_analytics.enabled`: that code already exists
      // and is per-sales-channel, answering "does GA4 load on this storefront".
      // This one answers "does this client have Google Analytics at all".
      code: 'google_analytics.module_enabled',
      name: 'Google Analytics module enabled',
      description:
        'Switches GA4 injection, the custom-event mappings, the server-side delivery queue and the admin screen on or off for the whole platform. Separate from the per-channel switch, which decides where the tag actually loads. Nothing is dropped: mappings stay in the database and every setting keeps its value.',
      groupCode: 'google_analytics',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.ENABLED,
      name: 'Enable Google Analytics',
      description: 'Master switch for the module. Per-channel overridable.',
      groupCode: 'google_analytics',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.MEASUREMENT_ID,
      name: 'Measurement ID',
      description: 'GA4 Measurement ID (G-XXXXXXXXXX). Blank means the channel is untracked.',
      groupCode: 'google_analytics',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.ENHANCED_ECOMMERCE_ENABLED,
      name: 'Enhanced Ecommerce',
      description: 'Emit GA4 recommended ecommerce events (view_item, add_to_cart, begin_checkout, purchase).',
      groupCode: 'google_analytics',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_ENABLED,
      name: 'Server-side tagging',
      description: 'Route the channel\'s events through the server-side delivery worker instead of the browser.',
      groupCode: 'google_analytics',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_ENDPOINT,
      name: 'Server-side endpoint',
      description: 'Server-side GTM container URL. Blank uses the GA4 Measurement Protocol default endpoint.',
      groupCode: 'google_analytics',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_API_SECRET,
      name: 'Measurement Protocol API secret',
      description:
        'GA4 Measurement Protocol API secret (GA4 Admin → Data Streams → Measurement Protocol API secrets). Stored encrypted at rest; write-only.',
      groupCode: 'google_analytics',
      valueType: 'secret',
      defaultValue: '',
    },
    {
      code: GOOGLE_ANALYTICS_SETTING_CODES.REQUIRE_CONSENT,
      name: 'Require analytics consent',
      description: 'When enabled, GA loads in Consent Mode v2 denied-by-default until consent is granted.',
      groupCode: 'google_analytics',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'google_analytics',
  name: 'Google Analytics',
  description:
    'Google Analytics 4 integration: per-sales-channel activation and Measurement ID, Enhanced Ecommerce, configurable custom events, and optional server-side tagging.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  //
  // `cms` owns `cmsBlockSeedPort`, the seam the cookie-consent banner message
  // is kept in place through (feature 075 / D-87). Declared rather than withheld
  // as non-binding because the edge is binding in the direction that matters to
  // an operator: the banner text *is* that block, and a consent banner with no
  // message is not a reduced banner — it is a consent this deployment cannot
  // show it asked for.
  dependencies: ['audit_logs', 'cms', 'sales_channels', 'settings', 'auth'],
  settings: googleAnalyticsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'google_analytics:read', label: 'View Google Analytics configuration' },
    { code: 'google_analytics:write', label: 'Manage Google Analytics configuration and custom events' },
  ],
  actions: [
    {
      id: 'open-google-analytics',
      labelKey: 'actions.openGoogleAnalytics.label',
      descriptionKey: 'actions.openGoogleAnalytics.description',
      icon: 'Sparkles',
      targetRoute: '/google-analytics',
      requiredPermission: 'google_analytics:read',
      keywords: ['google', 'analytics', 'ga4', 'tracking', 'events', 'ecommerce'],
      weight: 240,
    },
    {
      id: 'new-google-analytics-event',
      labelKey: 'actions.newCustomEvent.label',
      descriptionKey: 'actions.newCustomEvent.description',
      icon: 'Plus',
      targetRoute: '/google-analytics/new',
      requiredPermission: 'google_analytics:write',
      keywords: ['google', 'analytics', 'ga4', 'event', 'zdarzenie', 'custom'],
      weight: 241,
    },
  ],
  activation: { settingCode: 'google_analytics.module_enabled', default: true },
});
