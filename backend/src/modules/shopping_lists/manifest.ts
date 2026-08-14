import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';

export const shoppingListsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'shopping_lists',
  groups: [{ code: 'shopping_lists', name: 'Shopping lists' }],
  settings: [
    {
      code: 'shopping_lists.enabled',
      name: 'Shopping lists enabled',
      description:
        'Switches customer shopping lists on or off: creating and sharing lists, saving a cart line to one, and converting a list into a quote request. Nothing is dropped — every list, its items and its sharing state stay in the database.',
      groupCode: 'shopping_lists',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/**
 * Shopping Lists module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'shopping_lists',
  name: 'Shopping Lists',
  description:
    'Customer-owned saved shopping lists.',
  version: '1.0.0',
  // Feature 072 (T133) — the edges were always there; the conversion is what
  // made them declarations. `carts` is deliberately absent: the service handed
  // back through `shoppingListServiceSink` points outward, and declaring the
  // consumer would invert the direction.
  dependencies: ['auth', 'catalog', 'orders', 'organizations', 'quote_requests', 'settings'],
  settings: shoppingListsSettingsManifest,
  // Feature 073 (Constitution XVII) — the operator's activation control. It
  // covered the quick-order surfaces too while this module hosted them; T139
  // separated the two, so this now switches shopping lists and nothing else.
  activation: { settingCode: 'shopping_lists.enabled', default: true },
});
