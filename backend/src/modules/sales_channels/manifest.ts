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
  settings: [],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'sales_channels',
  name: 'Sales Channels',
  description: 'Multi-channel storefront resolver and channel registry.',
  version: '1.0.0',
  dependencies: ['settings'],
  settings,
});

/** Legacy export retained for backward compatibility. */
export const salesChannelsManifest = settings;
