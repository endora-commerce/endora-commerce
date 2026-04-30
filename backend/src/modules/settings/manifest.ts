import { defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Built-in manifest for the settings module itself — feature 004 / T022.
 *
 * Seeds the platform-wide `general` group on every backend boot so other
 * modules' manifests can default-attach to it without a chicken-and-egg
 * problem. The group is `isSystemProtected: true`, which the admin service
 * (T034) refuses to delete.
 */
export const settingsManifest = defineModuleSettingsManifest({
  moduleCode: 'settings',
  groups: [
    {
      code: 'general',
      name: 'General',
      isSystemProtected: true,
      // Empty salesChannelCodes ⇒ applies to every sales channel.
    },
  ],
  settings: [],
});
