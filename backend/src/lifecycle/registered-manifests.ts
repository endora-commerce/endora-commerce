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

import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';
import { discoverOverlayModuleManifests } from '../overlay/overlay-runtime.js';
import {
  assertNoPackageModuleIdCollisions,
  type ModuleIdClaim,
} from '../packages/module-id-claims.js';
import type { ModuleIdClaimOrigin } from './services/module-origin.js';
import { provideDefaultGatingManifests } from './services/gating-graph.js';
/** Re-exported so a caller that already reads this registry has one import. */
export type { ModuleIdClaimOrigin };
import { discoverPackageModuleManifests } from '../packages/package-runtime.js';
import {
  DISCOVERED_MANIFESTS,
  type DiscoveredManifestEntry,
} from '../manifest-index.generated.js';

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
  /**
   * Where this entry came from — set where it is **constructed**, never derived
   * from {@link RegisteredManifestEntry.filePath} (feature 080, T040b).
   *
   * D-157.6(b) read the origin off the path, on the ground that everything this
   * build ships is under `backend/src`. That stopped being true with the first
   * module package: `packages/modules/blog` is under neither root, so it read as
   * `'package'`, and the two decisions resting on the answer — the first-boot
   * `module_registrations` insert and the boot settings reconcile — silently
   * skipped it. A module the build composes, whose migrations the committed
   * registry runs, would have had no activation Setting and no registry row, so
   * it would not have appeared on `/platform/modules` at all: Principle XVII
   * defeated by a path test, with nothing raised.
   *
   * There is no containment test that could be right here, which is why this is
   * a field. A workspace module package and an installed one are the same
   * directory shape, and in a deployed build both sit under `node_modules`. What
   * separates them is *which discovery produced the entry*, and that is known
   * exactly once — at the three construction sites below.
   */
  origin: ModuleIdClaimOrigin;
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
  /**
   * This module's declaration that its activity is eligible for the dashboard's
   * recent-activity card — feature 080, T042j / D-163.1. Travels with the entry
   * for the reason the hooks do: the derivation that replaced four
   * hand-maintained action tables reads it off the resolved set, so a core
   * module, an overlay module and an installed package reach the card by one
   * path.
   */
  recentActivity?: ModuleManifestExports['recentActivity'];
}

/**
 * `manifestEntryOrigin(filePath)` used to live here and is **deleted** (feature
 * 080, T040b).
 *
 * It answered "where did this entry come from" with a containment test against
 * `backend/src/modules` and `backend/src/apps`, on D-157.6(b)'s ground that
 * *"`filePath` origin is already on every entry, so the split needs no new
 * field"*. The premise held for exactly as long as every module this build ships
 * sat under `backend/src`. The first module package sits at
 * `packages/modules/<id>` and read as `'package'` — a module the composer bakes
 * in, whose migrations the committed registry runs, classified as something an
 * operator installed. Both readers of the answer skip a package, so the module
 * got no first-boot `module_registrations` row and no boot settings reconcile,
 * which means no activation Setting and no row on `/platform/modules`: it was
 * absent from the one screen that decides whether it runs, silently.
 *
 * No containment test can replace it. A workspace module package and an
 * installed one are the same directory shape, and in a **deployed** build both
 * resolve under `node_modules` — so the path cannot carry the answer at all.
 * What separates them is which discovery produced the entry, which is known at
 * construction and nowhere else; {@link RegisteredManifestEntry.origin} is that
 * knowledge, written once, by the three sites that have it.
 */

/**
 * Re-exported, declared in `@endora-commerce/platform` (D-160.11).
 *
 * The origin split has two readers and a derived fact written down twice is two
 * answers waiting to disagree (D-100): the boot settings reconcile is a
 * composition root's, and `firstBootInsertPopulation` is the presence load's,
 * which is the platform's. So the function lives beside the second reader and
 * both roots keep naming it here, where the registry is.
 */
export { deploymentShippedEntries } from './services/module-origin.js';

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
    // The generated index is bare core under every value of `DEPLOYMENT`
    // (D-104), so every entry it carries is one this build ships — including a
    // module that has become a workspace package, which the composer bakes in
    // with a bare specifier (D-149).
    origin: 'core',
    ...(discovered.installHook ? { installHook: discovered.installHook } : {}),
    ...(discovered.uninstallHook ? { uninstallHook: discovered.uninstallHook } : {}),
    ...(discovered.lifecycleParticipant
      ? { lifecycleParticipant: discovered.lifecycleParticipant }
      : {}),
    ...(discovered.cliCommands ? { cliCommands: discovered.cliCommands } : {}),
    ...(discovered.recentActivity ? { recentActivity: discovered.recentActivity } : {}),
  };
}

/** Raised when an index entry carries no location for the manifest it imported. */
export class ManifestPathMissingError extends Error {
  override readonly name = 'ManifestPathMissingError';
}

/**
 * The core registry: every discovered module, with the location the generator
 * recorded for it.
 *
 * The index has no deployment entry to filter out any more (D-104). It is a
 * walk of the shared core tree and nothing else, whatever `DEPLOYMENT` is set
 * to when it is generated — which is what makes the committed artefact mean the
 * same thing in every environment, and what makes a stale one detectable
 * (FR-004, issue #120).
 *
 * **The path is read, not computed** (feature 080, T041a). It used to be
 * `join(MODULES_ROOT, entry.id, 'manifest.ts')` — a convention, holding for as
 * long as every module sits at `backend/src/modules/<id>/`, and giving a
 * confident wrong answer the moment one does not. There is no reader of
 * `filePath` that does not take `dirname` of it and join a directory: the
 * `_i18n` boot reconciler joins `bundlesDir`, the orchestrator hands the same
 * directory to the install-time bundle load, and both **skip** a directory that
 * is absent. So a packaged module would have loaded no bundle, rendered every
 * command-palette label as its raw key, and reported nothing anywhere.
 *
 * An entry with no path is therefore refused rather than defaulted. There is no
 * honest fallback: the only candidate is the convention that just stopped
 * holding, and a registry that answers with a directory nobody verified is the
 * failure this replaces. The type makes the field required, which is what stops
 * a *new* emitter from omitting it; this refusal is for the older artefact — a
 * committed index generated before the field existed, or a hand-edited one —
 * which the type cannot reach because it was compiled against a different shape.
 */
export function coreManifestEntries(
  discovered: ReadonlyArray<DiscoveredManifestEntry>,
): RegisteredManifestEntry[] {
  return discovered.map((entry) => {
    const manifestPath = entry.manifestPath;
    if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
      throw new ManifestPathMissingError(
        `[registered-manifests] the generated index entry for '${entry.id}' carries no ` +
          `manifestPath. Every consumer takes dirname() of it to reach the module's own ` +
          `directory — its i18n bundles above all — and there is no convention left to ` +
          `guess one from, because a module may now live in a workspace package. ` +
          `Regenerate the index: pnpm --filter backend run composer:generate`,
      );
    }
    return entryFor(entry, manifestPath);
  });
}

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> =
  coreManifestEntries(DISCOVERED_MANIFESTS);

// The activation refusals' fallback graph, from the registry that knows which
// modules exist (D-160.11). `gating-graph.ts` used to read `REGISTERED_MANIFESTS`
// itself; it is in `@endora-commerce/platform` now, which may not name a file this
// application owns (D-52/D-53), and an empty default would be a refusal that never
// fires — the fall-open feature 073 removed. So the host supplies it, here, where
// the registry is: a process that can answer "which modules exist" has loaded this
// file, and one that has not is refused by `gatingGraph()` rather than answered.
// A composed process never reaches the fallback — the presence load installs the
// deployment's real set, overlay modules and installed packages included.
provideDefaultGatingManifests(() => REGISTERED_MANIFESTS.map((entry) => entry.manifest));

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
      origin: 'overlay',
      ...(found.installHook ? { installHook: found.installHook } : {}),
      ...(found.uninstallHook ? { uninstallHook: found.uninstallHook } : {}),
      ...(found.lifecycleParticipant
        ? { lifecycleParticipant: found.lifecycleParticipant }
        : {}),
      ...(found.cliCommands ? { cliCommands: found.cliCommands } : {}),
      ...(found.recentActivity ? { recentActivity: found.recentActivity } : {}),
    });
  }

  // Every claim at once, so the refusal reports all of them rather than the
  // first — an operator with two bad packages should have to run this once.
  const claims: ModuleIdClaim[] = [];
  for (const [id, entry] of byId) {
    claims.push({ id, origin: entry.origin, claimedBy: entry.filePath });
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
      origin: 'package',
      ...(found.installHook ? { installHook: found.installHook } : {}),
      ...(found.uninstallHook ? { uninstallHook: found.uninstallHook } : {}),
      ...(found.lifecycleParticipant
        ? { lifecycleParticipant: found.lifecycleParticipant }
        : {}),
      ...(found.cliCommands ? { cliCommands: found.cliCommands } : {}),
      ...(found.recentActivity ? { recentActivity: found.recentActivity } : {}),
    });
  }
  return [...byId.values()];
}
