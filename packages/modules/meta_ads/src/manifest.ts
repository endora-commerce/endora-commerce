import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { META_ADS_SETTING_CODES } from '@endora-commerce/contracts';

/**
 * Meta Ads module (feature 064). Puts the Meta Pixel on the storefront per sales
 * channel, reports Meta's standard commerce events, and lets an operator add
 * custom events alongside them.
 *
 * Per-channel configuration is stored through the Settings module. Server-side
 * reporting through Meta's Conversions API is deliberately out of v1 — see
 * specs/064-meta-ads/research.md §R7.
 */
export const metaAdsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'meta_ads',
  groups: [{ code: 'meta_ads', name: 'Meta Ads' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. **Platform-wide, and
      // deliberately NOT `meta_ads.enabled`.** That code already exists and
      // means something else: it is per-sales-channel and answers "is the
      // pixel is live on a given storefront channel". This one answers "does this client have the Meta Ads
      // capability at all". Adopting the existing code would have collapsed two
      // orthogonal questions into one switch — and, because an activation
      // control may only be written through the activation endpoint, would have
      // made the per-channel setting unwritable through the settings screen.
      code: 'meta_ads.module_enabled',
      name: 'Meta Ads module enabled',
      description:
        'Switches Meta Pixel injection, the custom-event mappings and the admin screen on or off for the whole platform. Separate from the per-channel switch, which decides where the tag actually loads. Nothing is dropped: mappings stay in the database and every setting keeps its value.',
      groupCode: 'meta_ads',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: META_ADS_SETTING_CODES.ENABLED,
      name: 'Enable Meta Ads',
      description: 'Master switch for the module. Per-channel overridable.',
      groupCode: 'meta_ads',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: META_ADS_SETTING_CODES.PIXEL_ID,
      name: 'Pixel ID',
      description:
        'Meta Pixel ID from Events Manager. Blank means the channel is untracked.',
      groupCode: 'meta_ads',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: META_ADS_SETTING_CODES.REQUIRE_CONSENT,
      name: 'Require analytics consent',
      description:
        'When enabled, nothing Meta-related runs until the visitor accepts the cookie banner.',
      groupCode: 'meta_ads',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

export const META_ADS_READ_PERMISSION = 'meta_ads:read';
export const META_ADS_WRITE_PERMISSION = 'meta_ads:write';

export const manifest = defineModuleManifest({
  id: 'meta_ads',
  name: 'Meta Ads',
  description:
    'Meta Ads integration: per-sales-channel Meta Pixel, consent-gated tracking, standard commerce events, and configurable custom events.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  dependencies: ['audit_logs', 'sales_channels', 'settings', 'auth'],
  settings: metaAdsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [
    { code: META_ADS_READ_PERMISSION, label: 'View Meta Ads configuration' },
    {
      code: META_ADS_WRITE_PERMISSION,
      label: 'Manage Meta Ads configuration and custom events',
    },
  ],
  actions: [
    {
      id: 'open-meta-ads',
      labelKey: 'actions.openMetaAds.label',
      descriptionKey: 'actions.openMetaAds.description',
      icon: 'Sparkles',
      targetRoute: '/meta-ads',
      requiredPermission: META_ADS_READ_PERMISSION,
      keywords: ['meta', 'facebook', 'instagram', 'pixel', 'ads', 'reklamy'],
      weight: 244,
    },
    {
      id: 'new-meta-custom-event',
      labelKey: 'actions.newCustomEvent.label',
      descriptionKey: 'actions.newCustomEvent.description',
      icon: 'Plus',
      targetRoute: '/meta-ads/new',
      requiredPermission: META_ADS_WRITE_PERMISSION,
      keywords: ['meta', 'pixel', 'event', 'zdarzenie', 'custom'],
      weight: 245,
    },
  ],
  activation: { settingCode: 'meta_ads.module_enabled', default: true },
});
