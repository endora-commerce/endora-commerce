import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { BackendServerHandle } from './test-server.js';
import { CustomerAccount, Organization } from './package-entities.js';
import { CUSTOMER_COOKIES } from './test-actors.js';
import { addOrganizationChannels } from './sales-channel-access.js';
import { assignOrganizationRole, predefinedRoleIdOf } from './seed-organization-roles.js';

/**
 * Organization fixtures for `carts`' permission tests
 * (`specs/170-organization-roles/` WP-04).
 *
 * "Must this buyer's basket be approved?" is `!can(buyer,
 * 'carts.order_without_approval')` (research R-4, R-25). An Organization
 * created the ordinary way gets a *Member* role holding every member default,
 * that code included, so its members order directly.
 * {@link requireCartApprovalForMembers} writes what migration M2 writes for an
 * Organization that had `requires_cart_approval` on (FR-071, R-18): its
 * *Member* role was offered `carts.order_without_approval` and
 * `quick_order.one_click` and holds neither.
 *
 * Plain SQL, like `seed-organization-roles.ts`, and **before** the first
 * request that reads the Organization's roles: the role cache
 * (`OrganizationRoleCache`, research R-16) is filled on the first read, and a
 * fixture does not drop it. Every Organization here is a fresh one for that
 * reason.
 */
export async function requireCartApprovalForMembers(
  em: Pick<EntityManager, 'execute'>,
  organizationId: string,
): Promise<void> {
  await em.execute(
    `update "organization_roles"
        set "member_defaults_offered" = array['carts.order_without_approval', 'quick_order.one_click'],
            "permissions" = array_remove(array_remove("permissions", 'carts.order_without_approval'), 'quick_order.one_click')
      where "organization_id" = ? and "kind" = 'member'`,
    [organizationId],
  );
}

/**
 * A custom role of `organizationId` granting exactly `permissions`; answers its id.
 *
 * The array travels as one Postgres array literal. `seedCustomOrganizationRole`
 * in `seed-organization-roles.ts` binds a JavaScript array to `?::text[]`,
 * which the driver expands into one placeholder per element, so any non-empty
 * list is refused as a malformed array literal; that helper is WP-02b's and
 * shared, so the fix is reported rather than made here.
 */
export async function seedRoleGranting(
  em: Pick<EntityManager, 'execute'>,
  organizationId: string,
  permissions: readonly string[],
): Promise<string> {
  const id = randomUUID();
  const name = `Cart fixture role ${id.slice(0, 8)}`;
  await em.execute(
    `insert into "organization_roles"
       ("id","organization_id","kind","name","name_normalized","permissions","created_at","updated_at")
     values (?, ?, 'custom', ?, lower(btrim(?)), ?::text[], now(), now())`,
    [id, organizationId, name, name, `{${[...permissions].sort().join(',')}}`],
  );
  return id;
}

/** How a fixture member is placed: a predefined role, or a custom one granting exactly these codes. */
export type CartFixtureRole = 'administrator' | 'member' | { readonly permissions: readonly string[] };

export interface CartFixtureActor {
  readonly id: string;
  readonly cookie: string;
  readonly email: string;
  /** The custom role's id, for a member placed on one. */
  readonly roleId?: string;
}

export interface CartFixtureOrganization {
  readonly organizationId: string;
  readonly actors: Readonly<Record<string, CartFixtureActor>>;
  /** Drops the stub sessions; call in `afterAll`. */
  release(): void;
}

/**
 * A fresh company Organization with the members named in `members`, signed in
 * through stub session cookies and bound to `channels`.
 */
export async function seedCartOrganization(
  h: BackendServerHandle,
  input: {
    readonly label: string;
    readonly members: Readonly<Record<string, CartFixtureRole>>;
    /** Members need approval: the *Member* role as M2 maps an approval-requiring Organization. */
    readonly approvalRequired?: boolean;
    readonly channels?: readonly string[];
  },
): Promise<CartFixtureOrganization> {
  const run = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const em = h.em();
  em.create(Organization, {
    id: organizationId,
    name: `${input.label} ${run}`,
    taxId: `PL170${organizationId.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'ul. Uprawnień 170', city: 'Warszawa', postalCode: '00-170', country: 'PL' },
  });
  await em.flush();
  if (input.approvalRequired) await requireCartApprovalForMembers(em, organizationId);

  const actors: Record<string, CartFixtureActor> = {};
  for (const [key, role] of Object.entries(input.members)) {
    const id = randomUUID();
    const email = `wp04-${key.toLowerCase()}-${run}@example.com`;
    em.create(CustomerAccount, {
      id,
      organizationId,
      email,
      passwordHash: 'not-a-real-hash',
      firstName: 'Wp04',
      lastName: key,
      organizationRoleId: await predefinedRoleIdOf(em, organizationId, role === 'administrator' ? 'administrator' : 'member'),
      emailVerifiedAt: new Date(),
    });
    await em.flush();
    let roleId: string | undefined;
    if (typeof role === 'object') {
      roleId = await seedRoleGranting(em, organizationId, role.permissions);
      await assignOrganizationRole(em, id, roleId);
    }
    const cookie = `stub-wp04-${key.toLowerCase()}-${run}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId };
    actors[key] = { id, cookie, email, ...(roleId ? { roleId } : {}) };
  }
  await addOrganizationChannels(h, organizationId, input.channels ?? ['pl_retail']);
  return {
    organizationId,
    actors,
    release: () => {
      for (const actor of Object.values(actors)) delete CUSTOMER_COOKIES[actor.cookie];
    },
  };
}
