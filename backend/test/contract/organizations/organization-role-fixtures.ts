import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { assignOrganizationRole } from '../../helpers/seed-organization-roles.js';

/**
 * `specs/170-organization-roles/` WP-03 — the role fixtures this package's
 * tests need beside the shared `seed-organization-roles.ts` (Wave 2 adds new
 * files only).
 *
 * `seedCustomOrganizationRole` there binds its `permissions` array as a query
 * parameter through `em.execute`, which expands an array into one parameter
 * per element, so `?::text[]` receives a scalar (or, for an empty list,
 * nothing) and PostgreSQL refuses the literal. This one writes the array as a
 * PostgreSQL array literal instead.
 */

type Queryable = Pick<EntityManager, 'execute'>;

/** A PostgreSQL `text[]` literal of `values` — codes and names hold no quote, comma or brace. */
function textArrayLiteral(values: readonly string[]): string {
  for (const value of values) {
    if (/[",{}\\\s]/.test(value)) throw new Error(`fixture value not literal-safe: ${value}`);
  }
  return `{${[...values].sort().join(',')}}`;
}

/** A custom role of `organizationId` granting exactly `permissions`; answers its id. */
export async function seedCustomRole(
  em: Queryable,
  input: { organizationId: string; permissions: readonly string[]; name?: string },
): Promise<string> {
  const id = randomUUID();
  const name = input.name ?? `Fixture role ${id.slice(0, 8)}`;
  await em.execute(
    `insert into "organization_roles"
       ("id","organization_id","kind","name","name_normalized","description","permissions","created_at","updated_at")
     values (?, ?, 'custom', ?, lower(btrim(?)), null, ?::text[], now(), now())`,
    [id, input.organizationId, name, name, textArrayLiteral(input.permissions)],
  );
  return id;
}

/** A custom role granting `permissions`, held by `customerAccountId`; answers the role id. */
export async function holdCustomRole(
  em: Queryable,
  input: { organizationId: string; customerAccountId: string; permissions: readonly string[]; name?: string },
): Promise<string> {
  const roleId = await seedCustomRole(em, input);
  await assignOrganizationRole(em, input.customerAccountId, roleId);
  return roleId;
}

/**
 * After a fixture writes `organization_roles` rows with plain SQL, the composed
 * process's role cache may still hold the Organization's roles as they were
 * (research R-16: a role Command drops it, a fixture does not). This drops the
 * entry the way a committed role Command would, so the next request reads the
 * roles the fixture wrote.
 */
export function dropOrganizationRoleCache(h: BackendServerHandle, organizationId?: string): void {
  const cradle = h.container.cradle as unknown as {
    organizationRoleCache: { invalidateLocal(organizationId?: string): void };
  };
  cradle.organizationRoleCache.invalidateLocal(organizationId);
}
