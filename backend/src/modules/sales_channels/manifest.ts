import { defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Built-in settings manifest for the sales-channels module — feature
 * 005 / T018.
 *
 * Reserves the `sales_channels` setting group so future channel-related
 * knobs (default theme, host-map default, etc.) have a stable home.
 * No settings are declared yet; subsequent features add them through
 * the same manifest.
 */
export const salesChannelsManifest = defineModuleSettingsManifest({
  moduleCode: 'sales_channels',
  groups: [
    {
      code: 'sales_channels',
      name: 'Sales Channels',
    },
  ],
  settings: [],
});
