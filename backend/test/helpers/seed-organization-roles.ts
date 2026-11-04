import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Organization-role fixtures (`specs/170-organization-roles/` WP-02b, T048) —
 * the shared helpers Wave 2 builds its permission tests on.
 *
 * Every Organization has its two predefined roles by construction (migration
 * M2's `after insert` trigger, research R-28), and every account holds one
 * (M3), so a fixture that creates an Organization and an account the ordinary
 * way already has both. What a test cannot get for free is a **custom** role
 * holding chosen codes, and a member who holds it; that is what this file is
 * for. Plain SQL on purpose: a fixture states rows, and the role Commands —
 * their name rules, limits and audit — are what the tests under them exercise.
 */

type Queryable = Pick<EntityManager, 'execute'>;

async function rows<T>(em: Queryable, sql: string, params: unknown[]): Promise<T[]> {
  return (await em.execute(sql, params)) as T[];
}

/** The id of `organizationId`'s predefined role of `kind`. */
export async function predefinedRoleIdOf(
  em: Queryable,
  organizationId: string,
  kind: 'administrator' | 'member',
): Promise<string> {
  const [row] = await rows<{ id: string }>(
    em,
    `select "id" from "organization_roles" where "organization_id" = ? and "kind" = ?`,
    [organizationId, kind],
  );
  if (!row) throw new Error(`Organization ${organizationId} has no ${kind} role — was it created before migration M2?`);
  return row.id;
}

/**
 * A custom role of `organizationId` granting exactly `permissions`. The name
 * defaults to a unique one, so files sharing an Organization do not collide on
 * the per-Organization name rule.
 */
export async function seedCustomOrganizationRole(
  em: Queryable,
  input: { organizationId: string; permissions: readonly string[]; name?: string; description?: string | null },
): Promise<string> {
  const id = randomUUID();
  const name = input.name ?? `Fixture role ${id.slice(0, 8)}`;
  await rows(
    em,
    `insert into "organization_roles"
       ("id","organization_id","kind","name","name_normalized","description","permissions","created_at","updated_at")
     values (?, ?, 'custom', ?, lower(btrim(?)), ?, ?::text[], now(), now())`,
    // A Postgres array literal, not a JS array: the driver expands an array
    // binding into a list of scalars, which `?::text[]` refuses
    // ("malformed array literal"). Codes are `<module>.<action>` in lower
    // snake case, so they need no quoting inside the literal.
    [id, input.organizationId, name, name, input.description ?? null, `{${[...input.permissions].sort().join(',')}}`],
  );
  return id;
}

/**
 * Makes `customerAccountId` hold `roleId` — a role of the account's own
 * Organization (the composite foreign key refuses any other).
 */
export async function assignOrganizationRole(
  em: Queryable,
  customerAccountId: string,
  roleId: string,
): Promise<void> {
  await rows(
    em,
    `update "customer_accounts" a
        set "organization_role_id" = r."id"
       from "organization_roles" r
      where a."id" = ? and r."id" = ? and r."organization_id" = a."organization_id"`,
    [customerAccountId, roleId],
  );
}

/** A custom role granting `permissions`, held by `customerAccountId`; answers the role id. */
export async function seedMemberWithPermissions(
  em: Queryable,
  input: { organizationId: string; customerAccountId: string; permissions: readonly string[]; name?: string },
): Promise<string> {
  const roleId = await seedCustomOrganizationRole(em, input);
  await assignOrganizationRole(em, input.customerAccountId, roleId);
  return roleId;
}

/**
 * Moves an account to another Organization **with** a role of it — the
 * fixture's spelling of what the write ports do (research R-34). A bare
 * `update customer_accounts set organization_id = …` is refused by the
 * composite foreign key, since the account's role belongs to the old one.
 */
export async function moveAccountToOrganization(
  em: Queryable,
  customerAccountId: string,
  organizationId: string,
  kind: 'administrator' | 'member' = 'member',
): Promise<void> {
  await rows(
    em,
    `update "customer_accounts"
        set "organization_id" = ?,
            "organization_role_id" = (select "id" from "organization_roles" where "organization_id" = ? and "kind" = ?)
      where "id" = ?`,
    [organizationId, organizationId, kind, customerAccountId],
  );
}
