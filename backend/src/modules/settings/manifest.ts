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
