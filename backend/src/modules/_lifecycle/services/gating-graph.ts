import type { ModuleManifest } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../registered-manifests.js';

/**
 * The graph the **presence refusals** read — feature 073, FR-008, Amendment A1.
 *
 * It is deliberately not the graph the installer reads. `ModuleDepGraph`
 * (`dep-graph.ts`) is built from `manifest.dependencies` alone because it has
 * to be a DAG: it computes the topological install order and the reverse
 * cascade order, and a cycle there fails the build. That constraint is what
 * makes a handful of *real* runtime edges undeclarable — `addresses` must
 * install after `organizations`, so `organizations` cannot declare `addresses`
 * back, however certainly its customer routes call `addressService`.
 *
 * Withholding the declaration used to hide the edge from everything, including
 * the flip-time refusals, which is how `catalog` came to resolve
 * `pricingService` from a module an operator can switch off with nothing
 * refusing the flip. The edges are now declared as
 * `manifest.acknowledgedDependencies` and this graph is their reader:
 *
 * | Direction | Edges used | Why |
 * | --- | --- | --- |
 * | deactivating X — who still needs X? | `dependencies` ∪ `acknowledgedDependencies` | an acknowledged edge is a live resolution; the owner disappearing under it is exactly the failure this refuses |
 * | activating X — what does X need? | `dependencies` only | the acknowledged edges are mutual **by construction**; requiring both ends present before either may be switched on is a deadlock, not a safeguard |
 *
 * That asymmetry is the same trade the install order makes, applied to the
 * other axis, and it is why one union graph with two accessors beats two
 * graphs.
 *
 * **`manifest.nonBindingDependencies` is the third array and this class reads
 * none of it** (D-44). Those edges are real container resolutions whose
 * declaring module has a defined behaviour when the owner is absent — a boot
 * push into an ungated registry, or a read guarded by an
 * `effectiveState.isPresent` probe — so there is nothing for a refusal to
 * protect and refusing anyway would kill the owner's activation control for no
 * gain. {@link nonBindingPortEdgesFrom} flattens them for
 * `check-port-dependencies.ts`, which wants the ownership claim and not the
 * lifecycle one; the omission from the constructor below is the decision, not
 * an oversight, and `test/unit/_lifecycle/gating-graph.test.ts` pins it in both
 * directions.
 */

/** One withheld edge, flattened from the declaring manifest. */
export interface AcknowledgedPortEdge {
  /** The module that resolves the port. */
  readonly moduleId: string;
  /** The module that owns it. */
  readonly dependsOn: string;
  /** The container registration name, e.g. `addressService`. */
  readonly port: string;
  readonly reason: string;
}

/**
 * Every acknowledged edge in a manifest set, keyed the way
 * `check-port-dependencies.ts` needs them: `<resolving module>:<port>`.
 *
 * The CI check and the runtime refusal read this one function over the one
 * declaration set, so the two cannot disagree about which edges exist — they
 * did, for as long as the list lived in the script as a constant.
 */
export function acknowledgedPortEdgesFrom(
  manifests: readonly ModuleManifest[],
): AcknowledgedPortEdge[] {
  const edges: AcknowledgedPortEdge[] = [];
  for (const manifest of manifests) {
    for (const edge of manifest.acknowledgedDependencies ?? []) {
      edges.push({
        moduleId: manifest.id,
        dependsOn: edge.moduleId,
        port: edge.port,
        reason: edge.reason,
      });
    }
  }
  return edges;
}

/** One non-binding edge, flattened from the declaring manifest — D-44. */
export interface NonBindingPortEdge {
  /** The module that reads the name. */
  readonly moduleId: string;
  /** The module that owns it. */
  readonly dependsOn: string;
  /** The container registration name, e.g. `promptActionToolRegistry`. */
  readonly name: string;
  readonly kind: 'contributes-to' | 'degrades-without';
  /** What stops working — `degrades-without` only, `null` for a contribution. */
  readonly whenAbsent: string | null;
  readonly reason: string;
}

/**
 * Every non-binding edge in a manifest set, keyed the way
 * `check-port-dependencies.ts` needs them: `<resolving module>:<name>`.
 *
 * It sits beside {@link acknowledgedPortEdgesFrom} rather than in the check,
 * for the reason that function exists: one declaration set, read by the check
 * and by the runtime, so the two cannot disagree about which edges exist. What
 * differs is who else reads it — an acknowledged edge reaches the graph below,
 * a non-binding one reaches nothing.
 */
export function nonBindingPortEdgesFrom(
  manifests: readonly ModuleManifest[],
): NonBindingPortEdge[] {
  const edges: NonBindingPortEdge[] = [];
  for (const manifest of manifests) {
    for (const edge of manifest.nonBindingDependencies ?? []) {
      edges.push({
        moduleId: manifest.id,
        dependsOn: edge.moduleId,
        name: edge.name,
        kind: edge.kind,
        whenAbsent: edge.whenAbsent ?? null,
        reason: edge.reason,
      });
    }
  }
  return edges;
}

/** Is this module effectively present? Supplied by the caller so this file stays pure. */
export type PresencePredicate = (moduleId: string) => boolean;

export class ModuleGatingGraph {
  /** moduleId → the modules it declares in `dependencies`. */
  private readonly declared = new Map<string, ReadonlySet<string>>();
  /** moduleId → the modules it acknowledges without declaring. */
  private readonly acknowledged = new Map<string, ReadonlySet<string>>();
  /** moduleId → everything that depends on it, by either kind of edge. */
  private readonly dependents = new Map<string, Set<string>>();

  constructor(manifests: readonly ModuleManifest[] = []) {
    const add = (owner: string, dependent: string): void => {
      let set = this.dependents.get(owner);
      if (!set) {
        set = new Set();
        this.dependents.set(owner, set);
      }
      set.add(dependent);
    };
    for (const manifest of manifests) {
      this.declared.set(manifest.id, new Set(manifest.dependencies));
      for (const dep of manifest.dependencies) add(dep, manifest.id);
      const acknowledged = new Set(
        (manifest.acknowledgedDependencies ?? []).map((edge) => edge.moduleId),
      );
      this.acknowledged.set(manifest.id, acknowledged);
      for (const dep of acknowledged) add(dep, manifest.id);
    }
  }

  /** `manifest.dependencies` — the install-ordering edges, and only those. */
  declaredDependenciesOf(moduleId: string): string[] {
    return [...(this.declared.get(moduleId) ?? [])].sort();
  }

  /** The withheld edges this module declares as acknowledged. */
  acknowledgedDependenciesOf(moduleId: string): string[] {
    return [...(this.acknowledged.get(moduleId) ?? [])].sort();
  }

  /** Direct dependents over **both** kinds of edge — the refusal direction. */
  dependentsOf(moduleId: string): string[] {
    return [...(this.dependents.get(moduleId) ?? [])].sort();
  }

  /**
   * Who would be left resolving a module that is no longer there.
   *
   * **Direct dependents only, and that is not an approximation.** A transitive
   * dependent can only be reached through an intermediate one; if that
   * intermediate is present it blocks here on its own account, and if it is
   * absent then the transitive dependent is already stranded on the
   * intermediate, which this flip neither causes nor repairs. So the refusal
   * decision is identical either way, and the direct set is the one an operator
   * can act on: these are the modules to switch off first.
   *
   * The same shape the CLI takes on the other axis — `orchestrator.disable`
   * blocks on currently-installed *direct* dependents (`dependents-block`).
   */
  presentDependentsOf(moduleId: string, isPresent: PresencePredicate): string[] {
    return this.dependentsOf(moduleId).filter((id) => id !== moduleId && isPresent(id));
  }

  /**
   * What this module needs that is not there — `dependencies` only.
   *
   * Acknowledged edges are excluded because they are mutual by construction:
   * `catalog` acknowledges `price_lists` while `price_lists` declares
   * `catalog`, so requiring each to be present before the other may be switched
   * on leaves a pair that can never be switched on again. The install order
   * makes exactly this trade, and for exactly this reason (Amendment A1).
   */
  absentDependenciesOf(moduleId: string, isPresent: PresencePredicate): string[] {
    return this.declaredDependenciesOf(moduleId).filter(
      (id) => id !== moduleId && !isPresent(id),
    );
  }
}

/**
 * Process singleton, read by the activation refusals.
 *
 * It defaults to the statically registered core manifests rather than to an
 * empty graph, because an empty graph is a refusal that never fires — the
 * silent fall-open this whole task exists to remove. {@link installGatingGraph}
 * replaces it with the deployment's real manifest set (core plus overlay
 * modules) as part of the presence load.
 */
let graph: ModuleGatingGraph | null = null;

export function gatingGraph(): ModuleGatingGraph {
  graph ??= new ModuleGatingGraph(REGISTERED_MANIFESTS.map((entry) => entry.manifest));
  return graph;
}

/** Install the deployment's manifest set. Idempotent; called from the presence load. */
export function installGatingGraph(manifests: readonly ModuleManifest[]): void {
  graph = new ModuleGatingGraph(manifests);
}
