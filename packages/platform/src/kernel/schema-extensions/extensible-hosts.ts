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
