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
    {
      // Shop / company contact information surfaced across the storefront
      // (footer, 404 "need help?" block, contact form recipients, etc.).
      code: 'shop',
      name: 'Shop information',
      // Empty salesChannelCodes ⇒ applies to every sales channel; values can
      // still be overridden per channel via the standard scope mechanism.
    },
    {
      // Storefront-template behaviour toggles (performance hints, etc.).
      code: 'storefront',
      name: 'Storefront',
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
    {
      code: 'shop.name',
      name: 'Shop name',
      description: 'Public name of the shop, shown across the storefront.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.address',
      name: 'Shop address',
      description: 'Postal address of the shop, shown across the storefront.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.contact_email',
      name: 'Main contact email',
      description: 'Primary email address used for general contact.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.support_email',
      name: 'Support / customer service email',
      description:
        'Email address of the support / customer service desk. Shown to ' +
        'customers when they need help (e.g. on the 404 page).',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.phone',
      name: 'Shop phone number',
      description: 'Contact phone number for the shop. May be left empty.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.contact_form_recipient_emails',
      name: 'Contact form recipient emails',
      description:
        'Recipient email address(es) for the storefront contact form. ' +
        'Multiple addresses can be provided, separated by commas.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      // Speculation Rules (prerender/prefetch) hint emitted by the storefront
      // template for near-instant navigations.
      code: 'storefront.speculation_rules.enabled',
      name: 'Enable Speculation Rules',
      description:
        'Emit a Speculation Rules script in the storefront so the browser can ' +
        'prerender/prefetch likely next pages for near-instant navigation. ' +
        'Note: this setting only has an effect if the active Storefront UI ' +
        'theme supports the Speculation Rules mechanism; themes that do not ' +
        'implement it will ignore the toggle.',
      groupCode: 'storefront',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // Eagerness level for the Speculation Rules above. "moderate" prerenders
      // on hover/pointer intent — the recommended balance between instant
      // navigation and resource use; "eager" speculates aggressively on every
      // eligible link, "conservative" only on pointer-down.
      code: 'storefront.speculation_rules.eagerness',
      name: 'Speculation Rules eagerness',
      description:
        'Eagerness for the storefront Speculation Rules: "conservative" ' +
        '(on pointer-down), "moderate" (on hover — recommended), or "eager" ' +
        '(as soon as links are discovered). Only applies when Speculation ' +
        'Rules are enabled and supported by the active Storefront UI theme.',
      groupCode: 'storefront',
      valueType: 'string',
      defaultValue: 'moderate',
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
