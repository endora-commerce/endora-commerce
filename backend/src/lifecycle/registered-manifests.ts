/**
 * The manifest registry's **binding** — three suppliers, and nothing else
 * (`specs/115-lifecycle-container-move/`, D115-2;
 * `contracts/operator-half.md` §3).
 *
 * The derivation is `@endora-commerce/platform/lifecycle`'s since Phase 3: the
 * core entries, the `origin` field and its three construction sites, the
 * `manifestPath` refusal, the collision assembly and the three-way merge are all
 * platform logic and sat here only because their **input** is the application's.
 * `manifest-index.generated.ts` is a fact about one repository's tree, is bare
 * core under every value of `DEPLOYMENT` (D-104) and is host-owned (D-160.3), so
 * it is **supplied** to the platform rather than reached by it (R3.1, FR-014).
 *
 * What is left is the wiring an instance must own anyway: which generated index
 * this build ships, which deployment this process runs as, and which packages an
 * operator installed. All three are facts about the process rather than about
 * the platform, and no package can write them for anybody.
 *
 * **The path and every exported name are kept deliberately** (R3.4). 121 files
 * import this module — `REGISTERED_MANIFESTS` alone is named 103 times — so
 * moving the file would be a 121-file rewrite whose entire content is a path,
 * while moving the derivation is this one file. It also survives the rest of
 * D-207 without a signature change: when `overlay/` and `packages/` move
 * (`specs/110-instance-repository/` Phase 2), the two suppliers below re-point
 * at the platform and `resolveManifestEntries` does not move.
 */

import {
  coreManifestEntries,
  provideDefaultGatingManifests,
  resolveManifestEntries,
  type RegisteredManifestEntry,
} from '@endora-commerce/platform/lifecycle';

import { DISCOVERED_MANIFESTS } from '../manifest-index.generated.js';
import { discoverOverlayModuleManifests } from '../overlay/overlay-runtime.js';
import { discoverPackageModuleManifests } from '../packages/package-runtime.js';

/** Re-exported so a caller that already reads this registry has one import. */
export type {
  ManifestSources,
  ModuleIdClaimOrigin,
  RegisteredManifestEntry,
} from '@endora-commerce/platform/lifecycle';
export { ManifestPathMissingError } from '@endora-commerce/platform/lifecycle';

/**
 * Re-exported, declared in `@endora-commerce/platform` (D-160.11).
 *
 * The origin split has two readers and a derived fact written down twice is two
 * answers waiting to disagree (D-100): the boot settings reconcile is a
 * composition root's, and `firstBootInsertPopulation` is the presence load's,
 * which is the platform's. So the function lives beside the second reader and
 * both roots keep naming it here, where the registry is.
 */
export {
  coreManifestEntries,
  deploymentShippedEntries,
} from '@endora-commerce/platform/lifecycle';

/** Every module this build ships, derived from the generated index (feature 071, F2). */
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
 * The **instance-resolved** manifest set — core, PLUS this deployment's overlay
 * modules, PLUS every Endora module package installed in this instance.
 *
 * `env` is an argument rather than an ambient read because one process resolves
 * both answers: a suite proves a module present with the deployment selected and
 * absent without it, in one run, and a `DEPLOYMENT` read at import time could
 * answer only one of them.
 */
export const resolvedManifestEntries = (
  env: NodeJS.ProcessEnv = process.env,
): Promise<RegisteredManifestEntry[]> =>
  resolveManifestEntries({
    core: REGISTERED_MANIFESTS,
    overlay: () => discoverOverlayModuleManifests(env),
    packages: () => discoverPackageModuleManifests(env),
  });
