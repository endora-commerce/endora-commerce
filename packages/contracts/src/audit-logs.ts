/**
 * Audit-log reference labels — "what is this row about, and where does it live?"
 * (feature 075, D-87 drain).
 *
 * The dashboard's Recent Activity card renders an audit row as a sentence: who
 * acted, on what, and a link to the thing acted on. The audit row itself holds
 * only an `objectType` and an `objectId`, so the label and the link have to come
 * from the module that owns the object — and `audit_logs` used to fetch them by
 * hand-writing SQL against five other modules' tables, invisible to every
 * import-level boundary check because raw SQL names no specifier.
 *
 * The direction is what was wrong, not just the SQL. `audit_logs` is a
 * cross-cutting *reader*: it is declared `nonDeactivatable`, so a `dependencies`
 * entry from it onto `catalog`, `inventory` or `price_lists` would make each of
 * those undeactivatable too — the lifecycle refuses to disable a module a
 * non-deactivatable one depends on. Five read ports would have bought five
 * edges pointing the wrong way and taken an operator's switch away from
 * `inventory` to render a warehouse name. So the question is inverted: each
 * owner pushes a resolver for its own object type, and the reader walks them.
 */

/** One resolved object: what to call it, and where the admin app shows it. */
export interface AuditReferenceLabel {
  /** The `objectId` this answers for. */
  readonly id: string;
  /**
   * The owner's display name for the row — a product name, a warehouse name, an
   * organisation name. Never empty: a resolver that has no name for a row omits
   * the row instead, and the reader falls back to the audit snapshot.
   */
  readonly label: string;
  /**
   * Admin deep link for the row, or `null` where the owner has no detail screen
   * for it.
   *
   * It travels on the descriptor because it is the owner's own admin route.
   * `audit_logs` used to spell `/catalog/products/{id}`, `/warehouses/{id}` and
   * `/price-lists/{id}` into its own switch statement, so three modules' route
   * shapes were pinned by a fourth module's dashboard.
   */
  readonly url: string | null;
}

/**
 * One contributed "turn these ids into labels" resolver.
 *
 * A module that owns rows an audit entry can point at registers one of these
 * per `referenceType`, from its own `ctx.onBoot`. It queries its **own** tables
 * and nothing else.
 *
 * `resolve` is bulk and is never called with an empty list: the reader buckets
 * a page of audit rows by type first, so a dashboard render costs one round trip
 * per type present rather than one per row. A resolver omits an id it cannot
 * find — the row was deleted, and the reader says so by falling back to the
 * audit snapshot and rendering no link.
 *
 * `ownerModuleId` is required and is the whole mechanism (D-39): without it the
 * registry could not state a policy for an absent owner at all.
 */
export interface AuditReferenceResolver {
  readonly ownerModuleId: string;
  /**
   * The audit row's `objectType` for a target, or the synthetic key the reader
   * uses for an actor bucket (`customer_account`). One resolver answers for one
   * type; two modules may not claim the same one.
   */
  readonly referenceType: string;
  resolve(ids: readonly string[]): Promise<AuditReferenceLabel[]>;
}

/**
 * Container name: `auditReferenceRegistry`. Owner: `audit_logs`.
 *
 * A **contribution seam**: contributors push from a boot hook and read nothing
 * back, so the registration is a plain `ctx.di.register` rather than a
 * `providePort` — a boot hook that resolved a gate would stop the backend from
 * starting whenever the registry's owner was switched off.
 *
 * **Enumeration policy: an absent contributor's resolver is skipped.** That is
 * D-39's default and it is also the right answer here, on two grounds that
 * differ from the dictionary registries' (which honour, for referential
 * integrity). First, this is a *surface*: the descriptor supplies a deep link
 * into an admin screen, and a screen a module that is not present does not
 * contribute is one no link should point at. Second, resolving would mean
 * reading a switched-off module's tables on its behalf, and a module that is off
 * behaves as if never installed (Constitution XVII).
 *
 * Skipping is a degrade, not a refusal, and it is the one this module's manifest
 * already commits to for actor names: the audit row still renders, with the
 * snapshot label the entry carries or the raw id, and no link. The record
 * outlives the directory.
 *
 * `owners()` stays presence-blind, for diagnostics and for the composition
 * tests that assert who contributed.
 */
export interface AuditReferenceRegistryPort {
  register(resolver: AuditReferenceResolver): void;
  /** The contributing module of every registered resolver, in registration order. */
  owners(): readonly string[];
  /**
   * Labels for these ids of this type, keyed by id. Ids the owner has no row for
   * are absent from the map, and so is every id of a type whose contributor is
   * not effectively present.
   */
  resolve(
    referenceType: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, AuditReferenceLabel>>;
}
