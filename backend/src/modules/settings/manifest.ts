import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Built-in settings manifest for the settings module itself — feature 004.
 *
 * Seeds the platform-wide `general` group on every backend boot so other
 * modules' manifests can default-attach to it without a chicken-and-egg
 * problem. The group is `isSystemProtected: true`, which the admin service
 * refuses to delete.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'settings',
  groups: [
    {
      code: 'general',
      name: 'General',
      isSystemProtected: true,
      // Empty salesChannelCodes ⇒ applies to every sales channel.
    },
  ],
  settings: [
    {
      // Image URL shown when a product has no image of its own, on product
      // cards / listings (and the product page). Resolvable globally or
      // per sales channel via the standard settings scope mechanism.
      code: 'product_image_placeholder_url',
      name: 'Product image placeholder',
      description:
        'Image displayed on product cards and listings when a product has no ' +
        'image of its own. Upload a file (drag-and-drop or file picker) or enter ' +
        'an image URL. Leave empty to show no placeholder. Can be overridden per ' +
        'sales channel.',
      groupCode: 'general',
      valueType: 'string',
      defaultValue: '',
    },
    {
      // Minutes of inactivity after which an admin is signed out of the Admin
      // UI. Enforced client-side by an idle timer in the admin app.
      code: 'admin.idle_logout_minutes',
      name: 'Admin idle logout (minutes)',
      description:
        'Number of minutes of inactivity after which an administrator is ' +
        'automatically signed out of the Admin UI. Default 60.',
      groupCode: 'general',
      valueType: 'number',
      defaultValue: 60,
    },
    {
      // Slug (URL path) of the CMS page to serve as the storefront home page.
      // Empty ⇒ the storefront falls back to its built-in landing page. Can be
      // overridden per sales channel.
      code: 'homepage_cms_page_slug',
      name: 'Home page CMS page',
      description:
        'Slug (URL path) of the CMS page to use as the storefront home page, ' +
        'e.g. "welcome". Leave empty to use the built-in landing page. Can be ' +
        'overridden per sales channel.',
      groupCode: 'general',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

/** Module-lifecycle manifest (feature 018) + i18n bundle declaration (feature 019). */
export const manifest = defineModuleManifest({
  id: 'settings',
  name: 'Settings',
  description: 'Per-module setting registry, admin UI, and value resolver.',
  version: '1.0.0',
  dependencies: [],
  settings,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'settings:read', label: 'View settings' },
    { code: 'settings:write', label: 'Edit settings' },
  ],
  actions: [
    {
      id: 'open-settings',
      labelKey: 'actions.openSettings.label',
      descriptionKey: 'actions.openSettings.description',
      icon: 'Settings',
      targetRoute: '/settings',
      keywords: ['settings', 'preferences', 'config', 'ustawienia'],
      weight: 250,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const settingsManifest = settings;
