import {
  CUSTOM_FIELD_HOST_BINDINGS,
  type ExtensibleHostTable,
} from '@endora-commerce/contracts';

/**
 * Which tables an extension may declare columns on
 * (`specs/178-extensible-columns/` FR-010, FR-011; research R-8).
 *
 * **Derived, never listed** (OD-15): every custom-field host table is
 * extensible, so the list is read off `CUSTOM_FIELD_HOST_BINDINGS`, the one
 * registry `custom_fields` reads too. The owner is the module whose entity maps
 * the table — the module a declaring module must depend on (V10).
 */

export interface ExtensibleHost {
  readonly table: string;
  readonly ownerModuleId: string;
}

/** table → host. */
export type ExtensibleHostSet = ReadonlyMap<string, ExtensibleHost>;

/** Every extensible host the bindings derive, rolled out or not. */
export const EXTENSIBLE_HOSTS: ExtensibleHostSet = new Map(
  Object.values(CUSTOM_FIELD_HOST_BINDINGS).map(
    (binding) => [binding.table, { table: binding.table, ownerModuleId: binding.ownerModuleId }] as const,
  ),
);

/**
 * The hosts rolled out so far — **temporary** (FR-011).
 *
 * Phase A shipped it empty (the mechanism inert). Phase B rolls out
 * `organizations` alone (OD-178-4, D-291): a declaration on any other host is
 * refused at discovery as `host-not-extensible`. Phase D deletes it together
 * with the test asserting it, leaving the derived list as the whole answer.
 */
export const SCHEMA_EXTENSION_ROLLOUT: readonly ExtensibleHostTable[] = ['organizations'];

/** The derived list narrowed to the rollout — what discovery validates against. */
export function rolledOutExtensibleHosts(): ExtensibleHostSet {
  const rolledOut = new Set<string>(SCHEMA_EXTENSION_ROLLOUT);
  return new Map([...EXTENSIBLE_HOSTS].filter(([table]) => rolledOut.has(table)));
}

/**
 * A host a **side table** may extend (`specs/187-side-table-extensions/`
 * FR-002, FR-003): the D2 host plus the class name of the entity that maps
 * its table — the second half of the declaration's
 * `<ownerModuleId>.<EntityClassName>` reference, and the parent name a
 * `@TransitivelyScoped` side entity must give.
 *
 * A separate interface rather than a new required field on
 * {@link ExtensibleHost}: that type is published on `./db` and constructed by
 * instance code (a throwaway host set in a test), so widening it would be a
 * breaking change to D2 for a fact only D1 reads.
 */
export interface EntityExtensionHost extends ExtensibleHost {
  readonly entityClassName: string;
}

/**
 * `organizations.Organization` → host. **Every** binding, with no rollout
 * constant (research R-3): a side table writes nothing on its host, only a
 * foreign key pointing at it, so there is nothing to roll out host by host.
 */
export const ENTITY_EXTENSION_HOSTS: ReadonlyMap<string, EntityExtensionHost> = new Map(
  Object.values(CUSTOM_FIELD_HOST_BINDINGS).map(
    (binding) =>
      [
        `${binding.ownerModuleId}.${binding.entityClassName}`,
        { table: binding.table, ownerModuleId: binding.ownerModuleId, entityClassName: binding.entityClassName },
      ] as const,
  ),
);
