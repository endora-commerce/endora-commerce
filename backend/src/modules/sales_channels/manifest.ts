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
      // Feature 073 — the operator's activation control. Platform-wide, and it
      // covers the administration surface only: since T110 the kernel composes
      // channel *resolution*, so switching this off freezes the channel
      // configuration rather than un-resolving every storefront request.
      code: 'sales_channels.enabled',
      name: 'Sales channel administration enabled',
      description:
        'Switches the sales-channel administration screens on or off: creating, editing and retiring channels, and managing which entities belong to which channel. Existing channels keep resolving for storefront and admin requests, and every channel, membership and per-channel setting stays in the database.',
      groupCode: 'sales_channels',
      valueType: 'boolean',
      defaultValue: true,
    },
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
  // Rule 2 (bridge owner) — specs/065-manifest-aware-migrations/research.md §R9.
  // This module owns nine `sales_channel_*` membership bridges plus
  // `sales_channels.logo_asset_id`, so its tables foreign-key nine other
  // modules. None of those edges is declared: the module that cannot function
  // without channel scoping is the *domain* module, and every one of them
  // already declares `sales_channels`. Four of the nine reverse edges close a
  // cycle outright — sales_channels → catalog → sales_channels,
  // sales_channels → cms → sales_channels,
  // sales_channels → promotions → sales_channels, and
  // sales_channels → customer_accounts → price_lists → catalog →
  // sales_channels; together they are what made the naive union a 9-node SCC.
  // The remaining five (assets_library, delivery_methods, organizations,
  // payment_methods, taxes) close no cycle but are dropped by the same rule: a
  // bridge owner declaring what it bridges inverts the ownership direction.
  // Eight are recorded in test/unit/db/acknowledged-fk-edges.ts; the ninth,
  // `sales_channels.logo_asset_id → assets`, is recorded there as
  // `kernel → assets_library` because feature 072 T019 moved the SalesChannel
  // entity — and with it the ownership of the `sales_channels` table — into the
  // kernel. The nine bridge tables stay owned by this module.
  //
  // Forward-looking convention: a new bridge table for module X is owned by X's
  // migration, so X → sales_channels covers it and no new exception is needed.
  dependencies: ['dictionaries', 'settings'],
  settings,
  activation: { settingCode: 'sales_channels.enabled', default: true },
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'sales_channels:read', label: 'View sales channels' },
    { code: 'sales_channels:write', label: 'Manage sales channels' },
  ],
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
