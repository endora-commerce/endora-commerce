import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { LINKEDIN_ADS_SETTING_CODES } from '@endora-commerce/contracts';

/**
 * LinkedIn Ads module (feature 063). Puts the LinkedIn Insight Tag on the
 * storefront per sales channel and reports mapped conversions, either from the
 * browser via `lintrk` or — opt-in per channel — from the backend through
 * LinkedIn's Conversions API.
 *
 * Per-channel configuration is stored through the Settings module; the
 * Conversions API access token uses the `secret` value type (feature 043,
 * AES-256-GCM at rest, write-only at the admin boundary).
 */
export const linkedInAdsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'linkedin_ads',
  groups: [{ code: 'linkedin_ads', name: 'LinkedIn Ads' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. **Platform-wide, and
      // deliberately NOT `linkedin_ads.enabled`.** That code already exists and
      // means something else: it is per-sales-channel and answers "is the
      // tag is live on a given storefront channel". This one answers "does this client have the LinkedIn Ads
      // capability at all". Adopting the existing code would have collapsed two
      // orthogonal questions into one switch — and, because an activation
      // control may only be written through the activation endpoint, would have
      // made the per-channel setting unwritable through the settings screen.
      code: 'linkedin_ads.module_enabled',
      name: 'LinkedIn Ads module enabled',
      description:
        'Switches the LinkedIn Insight Tag, the conversion mappings and the admin screen on or off for the whole platform. Separate from the per-channel switch, which decides where the tag actually loads. Nothing is dropped: mappings stay in the database and every setting keeps its value.',
      groupCode: 'linkedin_ads',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: LINKEDIN_ADS_SETTING_CODES.ENABLED,
      name: 'Enable LinkedIn Ads',
      description: 'Master switch for the module. Per-channel overridable.',
      groupCode: 'linkedin_ads',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: LINKEDIN_ADS_SETTING_CODES.PARTNER_ID,
      name: 'Partner ID',
      description:
        'LinkedIn Insight Tag Partner ID from Campaign Manager. Blank means the channel is untracked.',
      groupCode: 'linkedin_ads',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: LINKEDIN_ADS_SETTING_CODES.REQUIRE_CONSENT,
      name: 'Require analytics consent',
      description:
        'When enabled, nothing LinkedIn-related runs until the visitor accepts the cookie banner.',
      groupCode: 'linkedin_ads',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: LINKEDIN_ADS_SETTING_CODES.SERVER_SIDE_ENABLED,
      name: 'Server-side conversions',
      description:
        "Report mapped conversions from the backend through LinkedIn's Conversions API instead of the browser. Requires an access token.",
      groupCode: 'linkedin_ads',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: LINKEDIN_ADS_SETTING_CODES.ACCESS_TOKEN,
      name: 'Conversions API access token',
      description:
        'OAuth access token authorised for the Conversions API. Stored encrypted at rest; write-only.',
      groupCode: 'linkedin_ads',
      valueType: 'secret',
      defaultValue: '',
    },
  ],
});

export const LINKEDIN_ADS_READ_PERMISSION = 'linkedin_ads:read';
export const LINKEDIN_ADS_WRITE_PERMISSION = 'linkedin_ads:write';

export const manifest = defineModuleManifest({
  id: 'linkedin_ads',
  name: 'LinkedIn Ads',
  description:
    'LinkedIn Ads integration: per-sales-channel Insight Tag, consent-gated tracking, configurable conversion mappings, and optional server-side reporting through the Conversions API.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  dependencies: ['audit_logs', 'sales_channels', 'settings', 'auth'],
  settings: linkedInAdsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: LINKEDIN_ADS_READ_PERMISSION, label: 'View LinkedIn Ads configuration' },
    {
      code: LINKEDIN_ADS_WRITE_PERMISSION,
      label: 'Manage LinkedIn Ads configuration and conversion mappings',
    },
  ],
  actions: [
    {
      id: 'open-linkedin-ads',
      labelKey: 'actions.openLinkedInAds.label',
      descriptionKey: 'actions.openLinkedInAds.description',
      icon: 'Sparkles',
      targetRoute: '/linkedin-ads',
      requiredPermission: LINKEDIN_ADS_READ_PERMISSION,
      keywords: ['linkedin', 'ads', 'insight tag', 'conversion', 'konwersje', 'reklamy'],
      weight: 242,
    },
    {
      id: 'new-linkedin-conversion-mapping',
      labelKey: 'actions.newConversionMapping.label',
      descriptionKey: 'actions.newConversionMapping.description',
      icon: 'Plus',
      targetRoute: '/linkedin-ads/new',
      requiredPermission: LINKEDIN_ADS_WRITE_PERMISSION,
      keywords: ['linkedin', 'conversion', 'mapping', 'konwersja', 'mapowanie'],
      weight: 243,
    },
  ],
  activation: { settingCode: 'linkedin_ads.module_enabled', default: true },
});
