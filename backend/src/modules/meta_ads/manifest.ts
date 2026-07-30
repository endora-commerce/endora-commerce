import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';
import { META_ADS_SETTING_CODES } from '@b2b/contracts';

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
  dependencies: ['audit_logs', 'sales_channels', 'settings'],
  settings: metaAdsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
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
});
