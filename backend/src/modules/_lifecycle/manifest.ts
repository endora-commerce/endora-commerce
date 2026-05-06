import { defineModuleManifest } from '@b2b/contracts';

/**
 * Bootstrap manifest for the lifecycle subsystem itself. Carries no
 * dependencies and no settings — every other module's manifest is
 * discovered relative to this sentinel entry.
 */
export const manifest = defineModuleManifest({
  id: '_lifecycle',
  name: 'Module Lifecycle',
  description:
    'Platform-internal subsystem that orchestrates install / uninstall / ' +
    'enable / disable / status across every domain module.',
  version: '1.0.0',
  dependencies: [],
});
