// The manifest registry, derived from the generated index (feature 071, F2).
//
// This file used to be generated too, and it imported the same manifest of the
// same module the index already imported — two committed artefacts, refreshed
// by two different commands, of which only a full build ran both. Deleting a
// module directory therefore regenerated one and left the other importing a
// path that no longer existed.
//
// Everything the second file added is derivable: a core module's `filePath` is
// its id under the modules root, and its install hooks are exports of the
// manifest the index already imports. So the index is the single generated
// registry, and what remains here is the derivation plus the one thing that
// genuinely cannot be baked into a committed array — an overlay module's
// directory, which depends on the deployment the process runs as.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import { overlayModulesRootFor, selectedDeployment } from '../../overlay/overlay-roots.js';
import {
  DISCOVERED_MANIFESTS,
  type DiscoveredManifestEntry,
} from './manifest-index.generated.js';

/**
 * Each entry carries a real `filePath` so downstream reconcilers can locate the
 * module's directory on disk — notably the i18n bundle loader
 * (`_i18n/plugin.ts`) does `dirname(entry.filePath)` and joins `bundlesDir` to
 * find each module's `i18n/<lang>.json` files. Without a real path,
 * `dirname('<static>')` resolves to `.`, no bundle ever loads, and every action
 * label renders as its raw i18n key.
 */
export interface RegisteredManifestEntry {
  manifest: ModuleManifest;
  filePath: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
}

/**
 * Convention: every core module lives at `backend/src/modules/<id>/manifest.ts`.
 * `import.meta.url` points at this `_lifecycle/registered-manifests.ts`, so
 * `dirname(dirname(...))` lands on the modules root.
 */
const MODULES_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pathFor = (id: string): string => join(MODULES_ROOT, id, 'manifest.ts');

/**
 * A hook key is set only when the module exports one: with
 * `exactOptionalPropertyTypes`, `{ installHook: undefined }` is not the same
 * value as an absent key, and the lifecycle asks `entry.installHook !== undefined`.
 */
function entryFor(
  discovered: DiscoveredManifestEntry,
  filePath: string,
): RegisteredManifestEntry {
  return {
    manifest: discovered.manifest,
    filePath,
    ...(discovered.installHook ? { installHook: discovered.installHook } : {}),
    ...(discovered.uninstallHook ? { uninstallHook: discovered.uninstallHook } : {}),
  };
}

/**
 * The core registry: every discovered module that is not a deployment's, with
 * its directory derived from its id.
 *
 * Overlay modules are left out here rather than filtered by their consumers,
 * because the core registry is what the shared build ships — it stays free of
 * per-deployment entries whichever deployment the generator ran for (FR-004).
 */
export function coreManifestEntries(
  discovered: ReadonlyArray<DiscoveredManifestEntry>,
): RegisteredManifestEntry[] {
  return discovered
    .filter((entry) => entry.overlay !== true)
    .map((entry) => entryFor(entry, pathFor(entry.id)));
}

/**
 * The **deployment-resolved** manifest set = the core registry PLUS any overlay
 * module the index discovered for the active deployment (feature 057).
 *
 * This stays a runtime merge on purpose: an overlay module's `filePath` resolves
 * against the deployment root, and the answer depends on which deployment the
 * process runs as — not on which tree the index was generated from. For a
 * bare-core build (`DEPLOYMENT` unset) the index carries no overlay entry, so
 * this returns the core registry unchanged (FR-008).
 */
export function mergeOverlayManifestEntries(
  core: ReadonlyArray<RegisteredManifestEntry>,
  discovered: ReadonlyArray<DiscoveredManifestEntry>,
  deployment: string | null,
): RegisteredManifestEntry[] {
  const byId = new Map<string, RegisteredManifestEntry>(
    core.map((entry) => [entry.manifest.id, entry]),
  );
  for (const entry of discovered) {
    if (byId.has(entry.id)) continue; // already in the core registry
    const filePath =
      deployment === null
        ? pathFor(entry.id)
        : join(overlayModulesRootFor(deployment), entry.id, 'manifest.ts');
    byId.set(entry.id, entryFor(entry, filePath));
  }
  return [...byId.values()];
}

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> =
  coreManifestEntries(DISCOVERED_MANIFESTS);

export function resolvedManifestEntries(): RegisteredManifestEntry[] {
  return mergeOverlayManifestEntries(
    REGISTERED_MANIFESTS,
    DISCOVERED_MANIFESTS,
    selectedDeployment(),
  );
}
