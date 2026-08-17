import type { EntityManager } from '@mikro-orm/postgresql';
import type { PromptActionRequest } from '../entities/prompt-action-request.entity.js';

/**
 * The bulk-progress contribution registry (feature 043 US2; D-72 point 4).
 *
 * A delegated prompt request that started a long-running bulk operation shows
 * live progress, and the progress lives in the module that started the bulk
 * run — `catalog` today. Until this class existed the seam was a **single
 * container name** `prompt_actions` defaulted to `undefined`, which a
 * composition root then overwrote with `catalog`'s resolver: a module may not
 * write a name another module owns, so the one contribution that could not
 * follow the other five out of the roots under D-44 was this one.
 *
 * Turning the slot into a registry keyed by contributing module is what lets it
 * follow: `catalog` pushes from its own boot hook, declares the edge as
 * `nonBindingDependencies` — `contributes-to`, so no operator is bound — and
 * neither composition root names `catalog/prompt-tools.js` any more.
 *
 * **Every entry names the module that contributed it (feature 074, FR-024).**
 * The push is ungated, because a boot hook runs whatever the contributing
 * module's effective state is and gating the push would turn a deactivation
 * into a permanently missing entry until the next restart. The presence
 * question is answered *here*, at enumeration.
 *
 * **The policy this registry states: an absent owner's resolver is skipped.**
 * {@link resolvers} and {@link apply} answer as if it were not registered;
 * {@link contributors} deliberately does not filter, so a diagnostic can still
 * say who would fold progress in if their module were on. Skipping is right
 * here and costs nothing that has to be recovered later:
 *
 *  1. Folding progress reads the *contributor's* tables — `catalog_bulk_operations`
 *     — through the contributor's own services. A module that is off must not
 *     be read through (Principle XVII).
 *  2. The absent behaviour already existed and is documented: with no resolver
 *     the request simply reports no progress, which is what a deployment that
 *     ships no `catalog` has always seen. There is no obligation to record, no
 *     money on the other side, and nothing a person has to settle by hand.
 *  3. The request is not lost with the progress. It keeps its row, its plan and
 *     its audit trail, and expires on the module's own TTL exactly as a request
 *     whose bulk run never reported does.
 */
export type BulkProgressResolver = (
  row: PromptActionRequest,
  em: EntityManager,
) => Promise<void>;

/** One contributed resolver, with the module that contributed it. */
export interface BulkProgressEntry {
  readonly resolve: BulkProgressResolver;
  readonly module: string;
}

export class PromptActionBulkProgressRegistry {
  private readonly entries: BulkProgressEntry[] = [];

  /**
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present, so a registry a unit test builds for itself keeps
   *   answering about the resolvers that test registered; the container
   *   registration wires it to the kernel's effective state.
   */
  constructor(private readonly isModulePresent: (moduleId: string) => boolean = () => true) {}

  register(moduleId: string, resolve: BulkProgressResolver): void {
    this.entries.push({ module: moduleId, resolve });
  }

  /** Every contributing module, presence-blind. Diagnostics read this. */
  contributors(): string[] {
    return this.entries.map((entry) => entry.module);
  }

  /** The resolvers whose owner is present, in registration order. */
  resolvers(): BulkProgressResolver[] {
    return this.entries
      .filter((entry) => this.isModulePresent(entry.module))
      .map((entry) => entry.resolve);
  }

  /**
   * Fold whatever live progress the present contributors have into `row`.
   *
   * Sequential rather than concurrent: each resolver mutates the same managed
   * row, and two of them writing `row.result` in parallel would make the last
   * write win by scheduling accident. There is one contributor today; the shape
   * is what makes a second one safe.
   */
  async apply(row: PromptActionRequest, em: EntityManager): Promise<void> {
    for (const resolve of this.resolvers()) {
      await resolve(row, em);
    }
  }
}
