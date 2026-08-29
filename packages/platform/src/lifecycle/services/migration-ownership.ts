/**
 * Which module owns which migration — the question `uninstall --hard` reverts
 * by, declared where the orchestrator that asks it lives (feature 080,
 * D-160.11).
 *
 * The **answer** is the host application's: it is merged from the committed
 * core registry plus whatever extension packages this instance installed, which
 * only a composition root knows. That merge stays in
 * `backend/src/db/configured-migrations.ts`, which re-exports this type so the
 * host's callers keep one name for it. What moved here is the *shape*, because
 * a platform file may not name a file the host owns (D-52/D-53) and the
 * orchestrator's whole use of it is `deps.migrationOwnership`.
 */

/**
 * Which module owns which migration, and — the part that has to be a separate
 * question — whether this registry is in a position to answer at all.
 *
 * `null` from {@link MigrationOwnership.migrationNamesFor} means *"I cannot
 * answer for that module"*, and an empty array means *"that module owns no
 * migration"*. Collapsing the two is the fail-open the lifecycle orchestrator
 * shipped: a package whose entries the orchestrator could not see
 * hard-uninstalled to a **warning** and left its table in the database
 * (D-155.3(c)). The return type is where the distinction lives, in the idiom
 * `allowedIdsFor(): Promise<string[] | null>` already uses in this tree —
 * a caller cannot forget to ask, because `null` is not a list of names.
 */
export interface MigrationOwnership {
  /**
   * Migration class names owned by `moduleId`, ascending by class name, or
   * `null` when this registry covers no module of that name.
   */
  migrationNamesFor(moduleId: string): readonly string[] | null;
  /** The modules this registry can answer for. Named in the refusal message. */
  readonly coveredModuleIds: ReadonlySet<string>;
}
