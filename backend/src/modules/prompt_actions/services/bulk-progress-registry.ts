import type {
  BulkProgressReader,
  BulkProgressSnapshot,
  PromptActionBulkProgressRegistryPort,
} from '@b2b/contracts';

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
 *
 * **D-76 inverted what a contributor hands back.** It used to be
 * `(row: PromptActionRequest, em: EntityManager) => Promise<void>`, and both
 * parameters were wrong in different ways: `em` was **dead** — the only
 * implementation destructured `row` alone — and `row` handed this module's
 * entity, and its state machine, to a contributor that then wrote `row.status`,
 * `row.error` and `row.result` for this module to flush. Whether a prompt
 * request is `completed`, `failed` or `completed_with_errors` is decided here
 * now; what a bulk operation did is the contributor's fact, and the snapshot is
 * exactly that fact.
 */

/** One contributed reader, with the module that contributed it. */
export interface BulkProgressEntry {
  readonly read: BulkProgressReader;
  readonly module: string;
}

export class PromptActionBulkProgressRegistry implements PromptActionBulkProgressRegistryPort {
  private readonly entries: BulkProgressEntry[] = [];

  /**
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present, so a registry a unit test builds for itself keeps
   *   answering about the resolvers that test registered; the container
   *   registration wires it to the kernel's effective state.
   */
  constructor(private readonly isModulePresent: (moduleId: string) => boolean = () => true) {}

  register(moduleId: string, read: BulkProgressReader): void {
    this.entries.push({ module: moduleId, read });
  }

  /** Every contributing module, presence-blind. Diagnostics read this. */
  contributors(): string[] {
    return this.entries.map((entry) => entry.module);
  }

  /** The readers whose owner is present, in registration order. */
  readers(): BulkProgressReader[] {
    return this.entries
      .filter((entry) => this.isModulePresent(entry.module))
      .map((entry) => entry.read);
  }

  /**
   * The first present contributor's snapshot of that bulk operation, or `null`
   * when no present contributor knows the id.
   *
   * Sequential and first-answer-wins rather than concurrent-and-merged: a bulk
   * operation id belongs to exactly one contributor, so a second answer would
   * be a second module claiming the same run. There is one contributor today;
   * the shape is what makes a second one safe.
   */
  async apply(bulkOperationId: string): Promise<BulkProgressSnapshot | null> {
    for (const read of this.readers()) {
      const snapshot = await read(bulkOperationId);
      if (snapshot !== null) return snapshot;
    }
    return null;
  }
}
