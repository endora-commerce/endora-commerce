import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { seedCustomOrganizationRole, assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import { OrganizationTreeService } from '../../../../packages/modules/organizations/src/backend/services/organization-tree-service.js';
import { anyReasonId, seedReturnableOrder, type SeededOrder } from './helpers.js';

/**
 * Organization fixtures for `returns`' permission tests
 * (`specs/170-organization-roles/` WP-14, OR-11; FR-052 – FR-054).
 *
 * Every Organization and account here is the calling file's own, so a role
 * changed in one file cannot move another file's rows. Custom roles are
 * inserted **before** the first request that reads the Organization's roles:
 * the role cache is filled on that read and a fixture does not drop it.
 * Changing which role an account holds is safe at any time — assignments are
 * not cached (research R-15).
 */

/** A fresh company Organization, bound to the fixture channels, rooted (`path`). */
export async function makeOrganization(em: EntityManager, label: string): Promise<string> {
  const id = randomUUID();
  const org = em.create(Organization, {
    id,
    name: `${label} ${id.slice(0, 8)}`,
    taxId: `PL14${id.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  });
  await em.persistAndFlush(org);
  await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
  org.path = `/${org.id}/`;
  await em.flush();
  return org.id;
}

/** Makes `branchId` a child of `headId` (the roll-up subtree). */
export async function reparent(h: BackendServerHandle, branchId: string, headId: string): Promise<void> {
  const tree = new OrganizationTreeService(h.em);
  await h.em().transactional(async (tx) => {
    const node = await tx.findOneOrFail(Organization, { id: branchId });
    const parent = await tx.findOneOrFail(Organization, { id: headId });
    tree.assertNoCycle(node, parent);
    await tree.assertMaxDepth(tx, node, parent);
    await tree.applyReparentPaths(tx, node, parent);
  });
}

export interface ReturnsFixtureMember {
  readonly id: string;
  readonly email: string;
  readonly organizationId: string;
  /** The stub session cookie value. */
  readonly cookie: string;
  /** The custom role's id, when the member was placed on one. */
  readonly roleId?: string;
}

/**
 * How a fixture member is placed: a predefined role, or a custom one granting
 * exactly these codes.
 */
export type ReturnsFixtureRole = 'administrator' | 'member' | { readonly permissions: readonly string[] };

const registeredCookies = new Set<string>();

/** A member of `organizationId`, signed in through a stub session cookie. */
export async function makeMember(
  em: EntityManager,
  organizationId: string,
  role: ReturnsFixtureRole,
  options: { rollup?: boolean; label?: string } = {},
): Promise<ReturnsFixtureMember> {
  const id = randomUUID();
  const email = `wp14-${(options.label ?? 'member').toLowerCase()}-${id.slice(0, 8)}@example.com`;
  em.create(CustomerAccount, {
    id,
    organizationId,
    email,
    passwordHash: 'x',
    firstName: 'WP14',
    lastName: options.label ?? 'Member',
    organizationRoleId: await predefinedRoleIdOf(em, organizationId, role === 'administrator' ? 'administrator' : 'member'),
    subtreeRollupEnabled: options.rollup ?? false,
    emailVerifiedAt: new Date(),
  });
  await em.flush();
  let roleId: string | undefined;
  if (typeof role === 'object') {
    roleId = await seedCustomOrganizationRole(em, { organizationId, permissions: role.permissions });
    await assignOrganizationRole(em, id, roleId);
  }
  const cookie = `stub-wp14-${id}`;
  CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId };
  registeredCookies.add(cookie);
  return { id, email, organizationId, cookie, ...(roleId ? { roleId } : {}) };
}

/** Drops every stub session this file registered; call in `afterAll`. */
export function releaseMembers(): void {
  for (const cookie of registeredCookies) delete CUSTOMER_COOKIES[cookie];
  registeredCookies.clear();
}

/** A completed, return-eligible order placed by `member` (lines of quantity 3 and 1). */
export function orderPlacedBy(em: EntityManager, member: ReturnsFixtureMember): Promise<SeededOrder> {
  return seedReturnableOrder(em, {
    organizationId: member.organizationId,
    placedByCustomerAccountId: member.id,
  });
}

export function asMember(
  h: BackendServerHandle,
  member: ReturnsFixtureMember,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  language: 'en' | 'pl' = 'en',
) {
  return h.app.inject({
    method,
    url,
    cookies: { b2b_session: member.cookie },
    headers: { 'accept-language': language, ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { payload } : {}),
  });
}

/** `POST /api/v1/returns` for one unit of the order's first line. */
export async function submitCase(
  h: BackendServerHandle,
  member: ReturnsFixtureMember,
  order: SeededOrder,
  options: { kind?: 'return' | 'complaint'; language?: 'en' | 'pl' } = {},
) {
  const reasonId = await anyReasonId(h.em());
  return asMember(
    h,
    member,
    'POST',
    '/api/v1/returns',
    {
      orderId: order.orderId,
      kind: options.kind ?? 'return',
      lines: [{ orderItemId: order.itemIds[0], quantity: 1, reasonId }],
    },
    options.language ?? 'en',
  );
}

/** Files a case and answers its id; fails the test when the filing is refused. */
export async function fileCase(
  h: BackendServerHandle,
  member: ReturnsFixtureMember,
  order: SeededOrder,
): Promise<string> {
  const res = await submitCase(h, member, order);
  if (res.statusCode !== 201) throw new Error(`filing a case failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: { id: string } }).data.id;
}

export const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string; details?: { permission?: string; permissionLabel?: string } } }).error;
