import type { EntityName } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The demo organisation, found by the tax ID the demo assigns it
 * (`specs/177-tax-id-scope/` FR-024, D-290 / OD-12).
 *
 * `findOne({ taxId })` was right while a tax ID sat on one row. In the
 * `per-tree-root` scope a head office and its branches share one, and
 * `findOne` answers whichever row comes first. So the lookup is the one
 * `organizationDetailsPort.findByTaxId(...)[0]` answers — the tree's root first,
 * then depth, creation time and id — written here because a composition step
 * receives an `EntityManager` and no container to resolve the port from. Live
 * rows only, as the port's default.
 */
export async function findDemoOrganization<T extends { id?: unknown }>(
  em: EntityManager,
  entity: EntityName<T>,
  taxId: string,
): Promise<T | null> {
  const [first] = (await em.execute(
    `select "id" from "organizations"
      where "tax_id" = ? and "deleted_at" is null
      order by ("root_id" is not distinct from "id") desc,
               coalesce(array_length(string_to_array(trim(both '/' from "path"), '/'), 1), 0) asc,
               "created_at" asc,
               "id" asc
      limit 1`,
    [taxId],
  )) as Array<{ id: string }>;
  if (!first) return null;
  return (await em.findOne(entity, { id: first.id } as never)) as T | null;
}
