import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Built-in settings manifest for the sales-channels module — feature 005.
 *
 * Reserves the `sales_channels` setting group so future channel-related
 * knobs (default theme, host-map default, etc.) have a stable home.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'sales_channels',
  groups: [
    {
      code: 'sales_channels',
      name: 'Sales Channels',
    },
  ],
  settings: [
    {
      code: 'sales_channels.storefront_url',
      name: 'Storefront URL',
      description:
        'Public base URL of the storefront for this sales channel. Used by the SEO sitemap generator and any other module that stamps absolute URLs into outgoing payloads. Empty value falls back to STOREFRONT_BASE_URL env.',
      groupCode: 'sales_channels',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'sales_channels',
  name: 'Sales Channels',
  description: 'Multi-channel storefront resolver and channel registry.',
  version: '1.0.0',
  dependencies: ['settings'],
  settings,
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'new-sales-channel',
      labelKey: 'actions.newSalesChannel.label',
      descriptionKey: 'actions.newSalesChannel.description',
      icon: 'Layers',
      targetRoute: '/sales-channels/new',
      requiredPermission: 'sales_channels:write',
      keywords: ['channel', 'new', 'storefront', 'kanał', 'sprzedaży'],
      weight: 150,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const salesChannelsManifest = settings;
