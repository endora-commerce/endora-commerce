/**
 * The manifest registry's **derivation** — the core entries, the origin field,
 * the path refusal, the collision assembly and the three-way merge
 * (`specs/115-lifecycle-container-move/`, D115-2;
 * `contracts/operator-half.md` §3).
 *
 * ## Why it is here and its input is not
 *
 * All of this lived in `backend/src/lifecycle/registered-manifests.ts`, because
 * its **input** does: the generated manifest index is a fact about one
 * repository's tree, is bare core under every value of `DEPLOYMENT` (D-104), and
 * an instance's is a different file (D-160.3). But *"which modules exist, which
 * of them claim the same id, and where did each entry come from"* is platform
 * logic, and it sat in the application only because the artefact that answers
 * the first clause is the application's.
 *
 * So the index is a **parameter**, never a reach: {@link coreManifestEntries}
 * takes the discovered array and {@link resolveManifestEntries} takes
 * {@link ManifestSources}. That is `specs/110-instance-repository/` FR-014
 * stated as a mechanism, and the precedent is one directory over —
 * `services/gating-graph.ts`'s `provideDefaultGatingManifests` is the host
 * installing a supplier the platform refuses to default, with a comment saying
 * exactly why the platform cannot read the registry itself. What that comment
 * did not do is apply the reasoning to the derivation, which is what this file
 * is.
 *
 * A parameter rather than a supplier slot, and the distinction is R3.2's: a slot
 * is right for a *fallback* most processes never need and that must refuse
 * rather than default. "Which modules exist" is answered at import,
 * deterministically, by whoever built the binding; a slot would make *"did
 * anyone supply it, and when?"* a runtime question in the one file whose job is
 * to have the answer.
 *
 * ## What is left in the application, and why it is twenty lines
 *
 * `backend/src/lifecycle/registered-manifests.ts` keeps its path and every name
 * it exports, and binds three suppliers — the generated index, this deployment's
 * overlay scan and this instance's installed packages. 121 files import that
 * path; moving the *file* would be a 121-file rewrite whose entire content is a
 * path, and moving the *derivation* is a one-file edit. An instance writes the
 * same twenty lines against its own three answers, which it owns regardless.
 */

import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';

import {
  assertNoModuleIdCollisions,
  type ModuleIdClaim,
  type ModuleIdClaimOrigin,
} from './services/module-id-claims.js';
import { platformResidentManifestEntries } from './resident.js';

/**
 * One entry of the host's generated manifest index, as this derivation reads it.
 *
 * Declared here rather than imported, because the artefact that emits it is the
 * host's (D-160.3) and the platform may not name a file in the tree that
 * installs it (D-52/D-53). `tsc` is what holds the two shapes together: the
 * generated interface is structurally assignable to this one at the call site,
 * so a generator that dropped a field fails in the host's own type-check.
 */
export interface DiscoveredManifestEntry {
  id: string;
  manifest: ModuleManifest;
  /**
   * The real path of the file this entry's manifest was imported from —
   * `<module>/manifest.ts` in an application tree, `<package>/package.json` for
   * a packaged module. Every consumer takes `dirname` of it.
   */
  manifestPath: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
  lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  cliCommands?: ModuleManifestExports['cliCommands'];
  recentActivity?: ModuleManifestExports['recentActivity'];
}

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
 * What an overlay scan yields for one of this deployment's own modules.
 *
 * Declared structurally for the reason {@link DiscoveredManifestEntry} is: the
 * scan reads a directory in the deployment tree, which is the installing tree's,
 * so the platform takes its **answer** and never its implementation.
 */
export interface OverlayModuleFound {
  readonly id: string;
  readonly manifest: ModuleManifest;
  readonly filePath: string;
  readonly installHook?: ModuleManifestExports['installHook'];
  readonly uninstallHook?: ModuleManifestExports['uninstallHook'];
  readonly lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  readonly cliCommands?: ModuleManifestExports['cliCommands'];
  readonly recentActivity?: ModuleManifestExports['recentActivity'];
}

/** What a `node_modules` scan yields for one installed Endora module package. */
export interface PackageModuleFound extends OverlayModuleFound {
  /** The npm package name, for diagnostics. Never the platform's identity (D-142). */
  readonly packageName: string;
}

/**
 * The three answers a resolved registry is made of, supplied by whoever knows
 * them (R3.1, R3.3).
 *
 * They stay three rather than collapsing into one supplier because they are
 * three different questions about *the process* with three different answers —
 * what this build ships, which deployment this is, and which packages an
 * operator installed — and a single supplier would hide which one raised a
 * collision.
 */
export interface ManifestSources {
  /** Every module this build ships, already derived from the host's generated index. */
  readonly core: readonly RegisteredManifestEntry[];
  /** This deployment's overlay modules. Empty for a bare-core build. */
  readonly overlay: () => Promise<readonly OverlayModuleFound[]>;
  /** Every Endora module package installed in this instance. Empty for a bare-core build. */
  readonly packages: () => Promise<readonly PackageModuleFound[]>;
}

/**
 * A hook key is set only when the module exports one: with
 * `exactOptionalPropertyTypes`, `{ installHook: undefined }` is not the same
 * value as an absent key, and the lifecycle asks `entry.installHook !== undefined`.
 */
type EntryLifecycleExports = Pick<
  RegisteredManifestEntry,
  'installHook' | 'uninstallHook' | 'lifecycleParticipant' | 'cliCommands' | 'recentActivity'
>;

function optionalExports(
  found: Readonly<EntryLifecycleExports>,
): EntryLifecycleExports {
  return {
    ...(found.installHook ? { installHook: found.installHook } : {}),
    ...(found.uninstallHook ? { uninstallHook: found.uninstallHook } : {}),
    ...(found.lifecycleParticipant
      ? { lifecycleParticipant: found.lifecycleParticipant }
      : {}),
    ...(found.cliCommands ? { cliCommands: found.cliCommands } : {}),
    ...(found.recentActivity ? { recentActivity: found.recentActivity } : {}),
  };
}

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
    ...optionalExports(discovered),
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

/**
 * The **instance-resolved** manifest set = the core registry, PLUS every
 * overlay module the active deployment ships (feature 057, D-104), PLUS every
 * Endora module package installed in this instance's `node_modules` (feature
 * 080, D-119/D-155).
 *
 * All three arrive through {@link ManifestSources}, each from the one
 * implementation that discovers it. There used to be two overlay
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
 * ## Collisions: one rule, whoever the claimants are
 *
 * A module id claimed twice is **refused**, naming every claimant's file
 * (T030c, D-155.7; widened to the overlay by feature 103, FR-004).
 *
 * The overlay half used to be answered differently — dropped with a `continue`,
 * on the reading that a deployment shadowing a module it authored is what the
 * overlay mechanism is for. File shadowing is retired (D-201), so that reading
 * has nothing left to refer to, and it was never the whole answer anyway: this
 * function dropped the manifest while `overlayModuleEntriesUnder` composed the
 * module, so the deployment ran a module the resolved registry did not know
 * about — no `module_registrations` row, no permission-catalogue entry, and its
 * routes gated on the effective state of somebody else's module of the same id.
 * Principle XVII defeated in silence.
 *
 * The refusal an overlay claim reaches is raised **before** this function sees
 * it, inside the overlay scan, so that the composition path reaches the same
 * rule without depending on a composition root calling this function first.
 * What is left here is the claim set no single scan can assemble: core, the
 * overlay and every installed package at once, so an operator with two bad
 * packages has to run this only once.
 */
export async function resolveManifestEntries(
  sources: ManifestSources,
): Promise<RegisteredManifestEntry[]> {
  const overlay = await sources.overlay();
  const packages = await sources.packages();
  const byId = new Map<string, RegisteredManifestEntry>(
    sources.core.map((entry) => [entry.manifest.id, entry]),
  );
  // The platform's own resident modules (`specs/110-instance-repository/` T141).
  // `_lifecycle`'s sources are this package's, so the only tree that could name
  // it is one carrying a generated index — and an instance carries none, which
  // is what left every instance refusing its own boot with
  // `not-shipped: _lifecycle`, needed by five modules of the set the scaffolder
  // itself writes.
  //
  // **Only where the host did not name it**, and appended rather than seeded, so
  // a host that does — this repository's generated index, through the
  // host-internal subpath — keeps its own entry *and* its own order. A `set`
  // over an existing key would keep the position and replace the value, which is
  // a difference nothing here needs to make. It is deliberately absent from the
  // claim set below for the same reason: two names for one module is not a
  // collision and must not be reported as one.
  for (const resident of platformResidentManifestEntries()) {
    if (!byId.has(resident.manifest.id)) byId.set(resident.manifest.id, resident);
  }
  for (const found of overlay) {
    byId.set(found.id, {
      manifest: found.manifest,
      filePath: found.filePath,
      origin: 'overlay',
      ...optionalExports(found),
    });
  }

  // Every claim at once, so the refusal reports all of them rather than the
  // first — an operator with two bad packages should have to run this once.
  //
  // Assembled from the three discoveries and **not** from `byId`, which is keyed
  // by id: reading the claim set off it would be asking a map that has already
  // resolved the collision whether there was one.
  const claims: ModuleIdClaim[] = [
    ...sources.core.map((entry) => ({
      id: entry.manifest.id,
      origin: entry.origin,
      claimedBy: entry.filePath,
    })),
    ...overlay.map((found) => ({
      id: found.id,
      origin: 'overlay' as const,
      claimedBy: found.filePath,
    })),
  ];
  for (const found of packages) {
    claims.push({
      id: found.id,
      origin: 'package',
      claimedBy: found.filePath,
      name: found.packageName,
    });
  }
  assertNoModuleIdCollisions(claims);

  for (const found of packages) {
    byId.set(found.id, {
      manifest: found.manifest,
      filePath: found.filePath,
      origin: 'package',
      ...optionalExports(found),
    });
  }
  return [...byId.values()];
}
