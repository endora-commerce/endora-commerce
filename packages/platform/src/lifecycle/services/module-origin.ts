/**
 * Which discovery produced a module entry, and the one split that is taken from
 * it (feature 080, D-160.11).
 *
 * It was declared in `backend/src/packages/module-id-claims.ts` and re-exported
 * through the host's manifest registry, which is a reach out of the platform
 * into the host application: the presence load types
 * `ShippedModuleEntry.origin` on it and narrows the first-boot insert
 * population with {@link deploymentShippedEntries}, and both of those are the
 * platform's. The **claims** machinery — who claimed an id, from which
 * `package.json`, and the refusal naming both — stays host-side, because it is
 * about runtime package discovery, which the host owns (D-119/D-155).
 *
 * There is deliberately no `'installed'` beside `'package'` and no containment
 * test that could produce one. A workspace module package and an installed one
 * are the same directory shape, and in a deployed build both resolve under
 * `node_modules`; what separates them is which discovery produced the entry,
 * which is known at construction and nowhere else.
 */

import type { ModuleManifest } from '@endora-commerce/contracts';

/** Where a claim on a module id came from. */
export type ModuleIdClaimOrigin = 'core' | 'overlay' | 'package';

/**
 * The entries **this build ships**: core plus the deployment's overlay modules,
 * never an installed package.
 *
 * The single spelling of D-157.6(b)'s split, because it has two readers and a
 * derived fact written down twice is two answers waiting to disagree (D-100).
 * Both readers converge state at boot for a module nobody ran a command for,
 * and both must stop at the same line:
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
 * `RegisteredManifestEntry` values.
 */
export function deploymentShippedEntries<E extends { readonly origin: ModuleIdClaimOrigin }>(
  entries: readonly E[],
): E[] {
  return entries.filter((entry) => entry.origin !== 'package');
}

/** A manifest plus where it came from — the minimum both readers above need. */
export interface OriginatedManifestEntry {
  readonly manifest: ModuleManifest;
  readonly origin: ModuleIdClaimOrigin;
}
