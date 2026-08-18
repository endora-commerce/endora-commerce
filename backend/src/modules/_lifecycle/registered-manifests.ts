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
import { discoverOverlayModuleManifests } from '../../overlay/overlay-runtime.js';
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
 * The core registry: every discovered module, with its directory derived from
 * its id.
 *
 * The index has no deployment entry to filter out any more (D-104). It is a
 * walk of the shared core tree and nothing else, whatever `DEPLOYMENT` is set
 * to when it is generated — which is what makes the committed artefact mean the
 * same thing in every environment, and what makes a stale one detectable
 * (FR-004, issue #120).
 */
export function coreManifestEntries(
  discovered: ReadonlyArray<DiscoveredManifestEntry>,
): RegisteredManifestEntry[] {
  return discovered.map((entry) => entryFor(entry, pathFor(entry.id)));
}

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> =
  coreManifestEntries(DISCOVERED_MANIFESTS);

/**
 * The **deployment-resolved** manifest set = the core registry PLUS every
 * overlay module the active deployment ships (feature 057, D-104).
 *
 * The overlay half is discovered at runtime, by the one implementation that
 * discovers it (`discoverOverlayModuleManifests`). There used to be two: this
 * function merged the generated index's overlay entries, `composition.ts`
 * merged the runtime scan's, and the one under test was not the one that ran.
 *
 * Runtime discovery is not an optimisation here, it is the only correct answer:
 * an overlay module's `filePath` resolves against the deployment root, and
 * which deployment that is depends on the process, not on the tree a generator
 * was run against. For a bare-core build (`DEPLOYMENT` unset) there is nothing
 * to discover and this returns the core registry unchanged (FR-008).
 */
export async function resolvedManifestEntries(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegisteredManifestEntry[]> {
  const overlay = await discoverOverlayModuleManifests(env);
  const byId = new Map<string, RegisteredManifestEntry>(
    REGISTERED_MANIFESTS.map((entry) => [entry.manifest.id, entry]),
  );
  for (const found of overlay) {
    if (byId.has(found.id)) continue; // core owns the id; an overlay may not shadow it here
    byId.set(found.id, {
      manifest: found.manifest,
      filePath: found.filePath,
      ...(found.installHook ? { installHook: found.installHook } : {}),
      ...(found.uninstallHook ? { uninstallHook: found.uninstallHook } : {}),
    });
  }
  return [...byId.values()];
}
