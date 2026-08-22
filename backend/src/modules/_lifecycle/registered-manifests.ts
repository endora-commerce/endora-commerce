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

import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import { discoverOverlayModuleManifests } from '../../overlay/overlay-runtime.js';
import {
  assertNoPackageModuleIdCollisions,
  type ModuleIdClaim,
  type ModuleIdClaimOrigin,
} from '../../packages/module-id-claims.js';
import { discoverPackageModuleManifests } from '../../packages/package-runtime.js';
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
  /**
   * This module's interest in every *other* module's install and hard
   * uninstall — feature 080, T036a / D-159. Travels with the entry so that a
   * `module:*` command, which composes nothing, gets the same reconcile the
   * admin path does.
   */
  lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  /**
   * The operator commands this module declares — feature 080, T042b / D-160.9.
   * Travels with the entry for the same reason the hooks do: the host's CLI
   * runner reads them off the resolved set, so a core module, an overlay module
   * and an installed package are reachable by one path.
   */
  cliCommands?: ModuleManifestExports['cliCommands'];
}

/**
 * Convention: every core module lives at `backend/src/modules/<id>/manifest.ts`.
 * `import.meta.url` points at this `_lifecycle/registered-manifests.ts`, so
 * `dirname(dirname(...))` lands on the modules root.
 */
const MODULES_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pathFor = (id: string): string => join(MODULES_ROOT, id, 'manifest.ts');

/**
 * `backend/src` under `tsx`/`vitest`, `backend/dist` in production — whichever
 * this file was loaded from. Both roots below are derived from it, so a build
 * that runs from `dist/` classifies its own modules exactly as a source run
 * does.
 */
const BUILD_ROOT = dirname(MODULES_ROOT);

/** `backend/src/apps` — every deployment's overlay lives under it (D-104). */
const OVERLAY_APPS_ROOT = join(BUILD_ROOT, 'apps');

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(root + sep);

/**
 * Where a resolved entry came from, read off the `filePath` every entry already
 * carries.
 *
 * D-157.6(b) — *"`filePath` origin is already on every entry, so the split needs
 * no new field"*. It is a **containment** test against the two roots this build
 * owns, not a `node_modules` segment test: pnpm links a workspace member into
 * `node_modules` too, so that segment is wrong in both directions, while
 * everything this build ships is under {@link BUILD_ROOT} by construction —
 * `backend/src/modules/<id>/manifest.ts` for core, and
 * `backend/src/apps/<deployment>/modules/<id>/manifest.ts` for an overlay. An
 * installed package anchors on the resolved `package.json` that claimed the id
 * (`PackageModuleManifest.filePath`), which is never inside either.
 *
 * `'package'` is therefore the answer for anything this build does not ship,
 * which is the direction to be wrong in: the one decision resting on it — the
 * first-boot insert — must not converge a module the platform did not install.
 */
export function manifestEntryOrigin(filePath: string): ModuleIdClaimOrigin {
  if (isUnder(filePath, MODULES_ROOT)) return 'core';
  if (isUnder(filePath, OVERLAY_APPS_ROOT)) return 'overlay';
  return 'package';
}

/**
 * The entries **this build ships**: core plus the deployment's overlay modules,
 * never an installed package.
 *
 * The single spelling of D-157.6(b)'s split, because it now has two readers and
 * a derived fact written down twice is two answers waiting to disagree (D-100).
 * Both readers converge state at boot for a module nobody ran a command for, and
 * both must stop at the same line:
 *
 *   - `firstBootInsertPopulation` — the `module_registrations` insert. A package
 *     converged here is a package `module:install` will answer
 *     `already-installed` about, having applied none of its migrations.
 *   - the **boot settings reconcile** (`composition.ts`, and the harness beside
 *     it). An overlay module has no `install` at all, so boot is the only author
 *     its activation Setting can have; a package has exactly one author,
 *     `install`, which reconciles its settings inside the operation that also
 *     runs its migrations. Reconciling a package's manifest at boot would let a
 *     `SettingCodeConflict` in something an operator merely `pnpm add`ed abort
 *     the platform's start.
 *
 * Generic over the entry, so a caller keeps whatever fields it had: the presence
 * load hands it `{ manifest, filePath }` and a composition root hands it whole
 * {@link RegisteredManifestEntry} values.
 */
export function deploymentShippedEntries<E extends { readonly filePath: string }>(
  entries: readonly E[],
): E[] {
  return entries.filter((entry) => manifestEntryOrigin(entry.filePath) !== 'package');
}

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
    ...(discovered.lifecycleParticipant
      ? { lifecycleParticipant: discovered.lifecycleParticipant }
      : {}),
    ...(discovered.cliCommands ? { cliCommands: discovered.cliCommands } : {}),
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
 * The **instance-resolved** manifest set = the core registry, PLUS every
 * overlay module the active deployment ships (feature 057, D-104), PLUS every
 * Endora module package installed in this instance's `node_modules` (feature
 * 080, D-119/D-155).
 *
 * All three halves after the first are discovered at runtime, each by the one
 * implementation that discovers it — `discoverOverlayModuleManifests` and
 * `discoverPackageModuleManifests`. There used to be two overlay
 * implementations: this function merged the generated index's overlay entries,
 * `composition.ts` merged the runtime scan's, and the one under test was not
 * the one that ran.
 *
 * Runtime discovery is not an optimisation, it is the only correct answer, and
 * D-104's predicate gives it for both: an artefact is committed when its
 * content is a fact about *the tree*, and resolved at runtime when it is a fact
 * about *the process*. Which deployment this process runs as is one; which
 * packages an operator installed into this instance is the other. For a
 * bare-core build with nothing installed — every developer checkout and every
 * test run — both discoveries come back empty and this returns the core
 * registry unchanged (FR-008).
 *
 * ## The two collisions, and why they are answered differently
 *
 * An **overlay** module claiming a core id is dropped (`continue`). That is the
 * shipped answer and it is right: a deployment shadowing a module it authored
 * is what the overlay mechanism is for, and the deployment can see both files.
 *
 * A **package** claiming an id that is already taken — by core, by the
 * deployment's overlay, or by another package — is **refused**, naming every
 * claimant's file (T030c, D-155.7). A stranger has no shadowing reading: the
 * operator installed something that cannot run here, and dropping it silently
 * disables a module they paid for while leaving its migrations, its settings
 * rows and its permissions to be attributed to somebody else's module of the
 * same id.
 */
export async function resolvedManifestEntries(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegisteredManifestEntry[]> {
  const overlay = await discoverOverlayModuleManifests(env);
  const packages = await discoverPackageModuleManifests(env);
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
      ...(found.lifecycleParticipant
        ? { lifecycleParticipant: found.lifecycleParticipant }
        : {}),
      ...(found.cliCommands ? { cliCommands: found.cliCommands } : {}),
    });
  }

  // Every claim at once, so the refusal reports all of them rather than the
  // first — an operator with two bad packages should have to run this once.
  const claims: ModuleIdClaim[] = [];
  for (const [id, entry] of byId) {
    claims.push({
      id,
      origin: overlay.some((found) => found.id === id) ? 'overlay' : 'core',
      claimedBy: entry.filePath,
    });
  }
  for (const found of packages) {
    claims.push({
      id: found.id,
      origin: 'package',
      claimedBy: found.filePath,
      name: found.packageName,
    });
  }
  assertNoPackageModuleIdCollisions(claims);

  for (const found of packages) {
    byId.set(found.id, {
      manifest: found.manifest,
      filePath: found.filePath,
      ...(found.installHook ? { installHook: found.installHook } : {}),
      ...(found.uninstallHook ? { uninstallHook: found.uninstallHook } : {}),
      ...(found.lifecycleParticipant
        ? { lifecycleParticipant: found.lifecycleParticipant }
        : {}),
      ...(found.cliCommands ? { cliCommands: found.cliCommands } : {}),
    });
  }
  return [...byId.values()];
}
