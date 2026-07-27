import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@b2b/contracts';

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
  dependencies: ['settings', 'sales_channels', 'audit_logs'],
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
});
