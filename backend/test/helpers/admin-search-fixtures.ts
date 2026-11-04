import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminSearchProvider, AdminSearchProviderQuery } from '@endora-commerce/contracts';
import type { BackendServerHandle } from './test-server.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Order,
  Organization,
  OrganizationSalesRepAssignment,
} from './package-entities.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from './seed-commerce.js';
import { withSystemScope } from '../../src/tenancy/escape-hatch.js';
import { bindOrganizationsToFixtureChannelsSql } from './sales-channel-access.js';
import { predefinedRoleIdOf } from './seed-organization-roles.js';

/**
 * Fixtures for `specs/150-admin-global-search/`'s server-bound tests.
 *
 * Every name a test searches for carries a per-run token, so the files that
 * share one database in a run never match each other's rows; lists are judged
 * by the rows a file seeded, never by length alone.
 */

/** The sales representative the global-search files act as (`stub-global-search-sales-rep-session`). */
export const GS_SALES_REP_ID = '00000000-0000-4000-8000-0000000150a1';
/** The custom-role admin (`stub-global-search-restricted-session`). */
export const GS_RESTRICTED_ID = '00000000-0000-4000-8000-0000000150a2';
/** The admin without `admin_search:configure` (`stub-global-search-no-configure-session`). */
export const GS_NO_CONFIGURE_ID = '00000000-0000-4000-8000-0000000150a3';

export const GS_COOKIES = {
  admin: { b2b_session: 'stub-admin-session' },
  salesRep: { b2b_session: 'stub-global-search-sales-rep-session' },
  restricted: { b2b_session: 'stub-global-search-restricted-session' },
  noConfigure: { b2b_session: 'stub-global-search-no-configure-session' },
} as const;

/** A lower-case alphanumeric token unique to this run. */
export function runToken(): string {
  return `gs${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** The provider for one record type, from the composed registry. */
export function providerFor(h: BackendServerHandle, entityType: string): AdminSearchProvider {
  const registry = h.container.resolve('adminSearchProviderRegistry') as { all(): AdminSearchProvider[] };
  const provider = registry.all().find((p) => p.entityType === entityType);
  if (!provider) throw new Error(`no admin search provider registered for ${entityType}`);
  return provider;
}

/** A provider query as the host builds it (escaping included), for direct provider calls. */
export function providerQuery(
  text: string,
  fields: readonly string[],
  over: Partial<AdminSearchProviderQuery> = {},
): AdminSearchProviderQuery {
  return {
    text,
    likeEscaped: text.replace(/[\\%_]/g, (ch) => `\\${ch}`),
    isUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text),
    fields,
    limit: 5,
    language: 'en',
    adminUserId: '00000000-0000-4000-8000-0000000000b1',
    signal: { aborted: false },
    ...over,
  };
}

/** Run a provider as a platform administrator would (the unrestricted tenant scope). */
export function searchAsPlatform(
  provider: AdminSearchProvider,
  query: AdminSearchProviderQuery,
): ReturnType<AdminSearchProvider['search']> {
  return withSystemScope('test: admin search provider as a platform admin', () => provider.search(query));
}

export async function seedOrganization(
  em: EntityManager,
  over: { name: string; taxId?: string; legalName?: string | null; isPersonal?: boolean; status?: string },
): Promise<Organization> {
  const org = em.create(Organization, {
    name: over.name,
    taxId: over.taxId ?? `PL${randomUUID().replace(/\D/g, '').slice(0, 10).padEnd(10, '7')}`,
    status: (over.status ?? 'active') as never,
    vatStatus: 'vat_payer',
    ...(over.legalName !== undefined ? { legalName: over.legalName } : {}),
    ...(over.isPersonal !== undefined ? { isPersonal: over.isPersonal } : {}),
    registeredAddress: { street: 'ul. Szukana 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
  } as never);
  await em.persistAndFlush(org);
  // Feature 154 — an Organization with no sales channel may not shop anywhere;
  // bind the stores the harness seeds.
  await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
  return org;
}

export async function seedCustomer(
  em: EntityManager,
  organizationId: string,
  over: { email: string; firstName?: string; lastName?: string },
): Promise<CustomerAccount> {
  const customer = em.create(CustomerAccount, {
    organizationId,
    email: over.email,
    passwordHash: 'x'.repeat(60),
    firstName: over.firstName ?? 'Gs',
    lastName: over.lastName ?? 'Customer',
    organizationRoleId: await predefinedRoleIdOf(em, organizationId, 'administrator'),
    emailVerifiedAt: new Date(),
  } as never);
  await em.persistAndFlush(customer);
  return customer;
}

export async function seedOrder(
  em: EntityManager,
  over: {
    organizationId: string;
    customerId: string;
    businessId: string;
    billingCompanyName?: string;
    billingTaxId?: string;
    status?: string;
  },
): Promise<Order> {
  const order = em.create(Order, {
    organizationId: over.organizationId,
    placedByCustomerAccountId: over.customerId,
    businessId: over.businessId,
    salesChannelId: '00000000-0000-4000-8000-0000000000c1',
    status: over.status ?? 'new',
    paymentStatus: 'awaiting_payment',
    deliveryAddress: { recipientName: 'GS', street: 'ul. Odbioru 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
    billingAddress: {
      recipientName: 'GS',
      street: 'ul. Rozliczeń 2',
      city: 'Kraków',
      postalCode: '30-001',
      country: 'PL',
      ...(over.billingCompanyName !== undefined ? { companyName: over.billingCompanyName } : {}),
      ...(over.billingTaxId !== undefined ? { taxId: over.billingTaxId } : {}),
    },
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
    subtotal: '10.00',
    taxTotal: '2.30',
    deliveryTotal: '0.00',
    total: '12.30',
    currency: 'PLN',
    placedAt: new Date(),
  } as never);
  await em.persistAndFlush(order);
  return order;
}

/**
 * The global-search sales representative, assigned to `organizationIds` only,
 * on the shared `sales_representative` role (the tenant scope keys on that
 * exact code). `permissions` are merged into the role and put back by the
 * returned cleanup, with the assignments.
 */
export async function ensureSalesRep(
  h: BackendServerHandle,
  organizationIds: readonly string[],
  permissions: readonly string[],
): Promise<() => Promise<void>> {
  let previous: string[] | null = null;
  await withSystemScope('test seed: global search sales representative', async () => {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, { code: 'sales_representative', name: 'Sales representative', permissions: [...permissions] });
    } else {
      previous = [...role.permissions];
      role.permissions = Array.from(new Set([...role.permissions, ...permissions]));
    }
    await em.persistAndFlush(role);
    await upsertAdmin(em, GS_SALES_REP_ID, 'global-search-sales-rep@example.com', role.id);
    for (const organizationId of organizationIds) {
      const existing = await em.findOne(OrganizationSalesRepAssignment, { adminUserId: GS_SALES_REP_ID, organizationId });
      if (!existing) em.create(OrganizationSalesRepAssignment, { adminUserId: GS_SALES_REP_ID, organizationId });
    }
    await em.flush();
  });
  return async () => {
    await withSystemScope('test cleanup: global search sales representative', async () => {
      const em = h.em();
      const rows = await em.find(OrganizationSalesRepAssignment, { adminUserId: GS_SALES_REP_ID });
      if (rows.length > 0) await em.removeAndFlush(rows);
      if (previous !== null) {
        const role = await em.findOne(AdminRole, { code: 'sales_representative' });
        if (role) {
          role.permissions = previous;
          await em.flush();
        }
      }
    });
  };
}

/** An admin on a custom role holding exactly `permissions` (role code per caller, so files do not share it). */
export async function ensureAdminWithRole(
  h: BackendServerHandle,
  adminUserId: string,
  roleCode: string,
  permissions: readonly string[],
): Promise<void> {
  await withSystemScope('test seed: global search custom-role admin', async () => {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code: roleCode });
    if (!role) role = em.create(AdminRole, { code: roleCode, name: roleCode, permissions: [...permissions] });
    else role.permissions = [...permissions];
    await em.persistAndFlush(role);
    await upsertAdmin(em, adminUserId, `${roleCode.replace(/_/g, '-')}@example.com`, role.id);
  });
}

async function upsertAdmin(em: EntityManager, id: string, email: string, roleId: string): Promise<void> {
  const existing = await em.findOne(AdminUser, { id });
  if (existing) {
    existing.adminRoleId = roleId;
    existing.status = 'active';
  } else {
    em.create(AdminUser, {
      id,
      email,
      passwordHash: 'x'.repeat(60),
      firstName: 'Global',
      lastName: 'Search',
      adminRoleId: roleId,
      status: 'active',
    });
  }
  await em.flush();
}

/** `GET /api/v1/admin/global-search` as `cookies`, narrowed to `entityTypes`; the group's hit ids. */
export async function searchIds(
  h: BackendServerHandle,
  cookies: Record<string, string>,
  q: string,
  entityTypes: string,
  extra = '',
): Promise<string[]> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/global-search?q=${encodeURIComponent(q)}&entityTypes=${entityTypes}&language=en&limit=25${extra}`,
    cookies,
  });
  if (res.statusCode !== 200) throw new Error(`global search answered ${res.statusCode}: ${res.body}`);
  const body = res.json() as { data: { groups: Array<{ entityType: string; hits: Array<{ id: string }> }> } };
  return body.data.groups.find((g) => g.entityType === entityTypes)?.hits.map((hit) => hit.id) ?? [];
}
