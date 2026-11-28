import type { EntityManager } from '@mikro-orm/core';
import type { z } from 'zod';

/**
 * A module's bulk loader for one declared side table
 * (`specs/187-side-table-extensions/` FR-053,
 * `contracts/extension-attributes-read-ports.md` §2).
 *
 * Registered with `ctx.entityExtensionLoaders([...])` by a module whose
 * manifest `extends` the host. A host read port that is asked for
 * `include: ['extensions.<moduleId>']` hands the ids of the records it already
 * authorised to `load`, once per read, on its own entity manager and in the
 * caller's async context.
 *
 * `load` resolves only ids that have a value — a missing id becomes `null` on
 * the record — and must issue a bounded number of statements whatever the
 * number of ids (one `in` query, never one per id). It must not widen scope
 * (`withSystemScope`): it is handed only what the caller may see. Its errors
 * are the read's errors; nothing catches them.
 */
export interface EntityExtensionLoaderEntry<T> {
  /** `<ownerModuleId>.<EntityClassName>` — a host this module declared in `extends`. */
  readonly host: string;
  /** Every value `load` returns is parsed with it; a refusal is a 500 naming the module. */
  readonly schema: z.ZodType<T>;
  /**
   * Also serve the value on the host's admin detail read, under
   * `?extensions=<moduleId>` (`specs/193-admin-form-extensions/` FR-015,
   * D-300.1; opt-in, as D2's `adminReads` is). Absent: the read ports alone
   * see it. Refused as `loader-and-columns-on-one-host` when this module also
   * serves `adminReads` columns on the host's table — one key holds one value.
   */
  readonly adminReads?: boolean;
  load(ids: readonly string[], ctx: { readonly em: EntityManager }): Promise<ReadonlyMap<string, T>>;
}

/** A loader as the registry holds it: attributed to the module whose context registered it. */
export interface RegisteredEntityExtensionLoader extends EntityExtensionLoaderEntry<unknown> {
  readonly moduleId: string;
  /** The declared side table the loader reads. */
  readonly table: string;
  /** The entry's `adminReads`, `false` when it named none. */
  readonly adminReads: boolean;
}
