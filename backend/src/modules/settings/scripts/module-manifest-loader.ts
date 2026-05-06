import type { ModuleSettingsManifest } from '@b2b/contracts';
import { settingsManifest } from '../manifest.js';
import { salesChannelsManifest } from '../../sales_channels/manifest.js';
import { blogManifest } from '../../blog/manifest.js';

/**
 * Map of module-code → manifest.
 *
 * Feature 004 / T025–T026: the CLI scripts (`pnpm modules:install`,
 * `pnpm modules:uninstall`) look up manifests through this loader instead of
 * importing the whole composition root. New modules add their manifest entry
 * here when they start declaring settings; the boot-time sync in
 * `composition.ts` consumes the same map indirectly via direct imports.
 */
const KNOWN_MANIFESTS: Record<string, ModuleSettingsManifest> = {
  settings: settingsManifest,
  sales_channels: salesChannelsManifest,
  blog: blogManifest,
  // Other modules add their manifest entries here as they ship their first setting.
};

export function loadManifestByModuleCode(
  moduleCode: string,
): ModuleSettingsManifest | undefined {
  return KNOWN_MANIFESTS[moduleCode];
}

export function listKnownModuleCodes(): string[] {
  return Object.keys(KNOWN_MANIFESTS).sort();
}
