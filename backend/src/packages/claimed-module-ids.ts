// Who already claims a module id in this instance (feature 103, FR-004).
//
// `module-id-claims.ts` owns the *rule* — one id, one claimant, refused by
// naming every claimant's file. This file owns the *sources*, so that the two
// readers of the overlay scan cannot answer the question from two different
// populations, which is the state feature 103 found:
//
//   - `resolvedManifestEntries` dropped a colliding overlay manifest with a
//     `continue`, and
//   - `overlayModuleEntriesUnder` composed the module with no id check at all.
//
// So a deployment could run a module the resolved registry did not know about:
// no `module_registrations` row, no permission-catalogue entry, and routes
// gated on the effective state of somebody else's module of the same id.
//
// **The claimed set is derived, never written down** (D-100). Core comes off
// the generated manifest index — the same array `REGISTERED_MANIFESTS` is
// derived from, carrying the same `manifestPath`, so a module that has become a
// workspace package (D-149) claims its id here exactly as it does there. The
// installed half comes off the package scan, which is the only thing that knows
// what an operator put in this instance's `node_modules`.
//
// It reads the index rather than `REGISTERED_MANIFESTS` for one structural
// reason: `registered-manifests.ts` imports the overlay runtime, which is one of
// this file's callers. Both read the same emitted entries, and
// `test/unit/overlay/overlay-id-collision.test.ts` holds the two populations to
// each other so the shortcut cannot drift into a second answer.

import { DISCOVERED_MANIFESTS } from '../manifest-index.generated.js';
import { nodeModulesRootsFor } from './installed-packages.js';
import type { ModuleIdClaim } from './module-id-claims.js';
import { installedPackageModuleIdClaims } from './package-runtime.js';

/** Every module id this build ships, with the manifest file that claims it. */
export function coreModuleIdClaims(): ModuleIdClaim[] {
  return DISCOVERED_MANIFESTS.map((entry) => ({
    id: entry.id,
    origin: 'core' as const,
    claimedBy: entry.manifestPath,
  }));
}

/**
 * Every claim on a module id that an overlay module does not make: this build's
 * own modules, plus every module package installed in this instance.
 *
 * This is what an overlay module's id has to be free of. It deliberately
 * excludes the overlay's own claims — the caller adds those, because the caller
 * is the one holding the root it scanned.
 */
export function claimsOutsideTheOverlay(
  env: NodeJS.ProcessEnv = process.env,
): ModuleIdClaim[] {
  return [...coreModuleIdClaims(), ...installedPackageModuleIdClaims(nodeModulesRootsFor(env))];
}
