import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  AdminRole,
  AdminUser,
  Order,
  Organization,
  OrganizationSalesRepAssignment,
} from './package-entities.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from './test-actors.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures shared by the `crm` contract and integration tests
 * (`specs/143-crm-sales-opportunities/`).
 *
 * **Why the workflow is restored rather than truncated.** The harness empties
 * `crm_opportunities` and its children between files by cascade from
 * `organizations` and `sales_channels`, but the five configuration tables hang
 * off nothing — and three of them are seeded by the module's own migration, so
 * declaring them volatile would hand every later file an empty workflow. A
 * file that changes the configuration therefore calls
 * {@link restoreDefaultCrmWorkflow} in its `beforeAll` (it does not trust what
 * an earlier file left) **and** in its `afterAll` (it does not leave anything
 * for a later one). That makes each file independent of run order in both
 * directions, which a restore in `afterAll` alone would not: a file that died
 * mid-way never reaches it.
 */

export const CRM_API = '/api/v1/admin/crm';

/** The platform administrator — holds every permission and reaches every Organization. */
export const CRM_ADMIN = { b2b_session: 'stub-admin-session' };

/** The workflow the init migration seeds, stated again here as what a test may assume. */
const DEFAULT_STATUSES: ReadonlyArray<{
  code: string;
  name: Record<string, string>;
  defaultName: string;
  kind: 'open' | 'won' | 'lost';
  isInitial: boolean;
  weight: number;
  color: string;
}> = [
  { code: 'new', name: { en: 'New', pl: 'Nowa' }, defaultName: 'New', kind: 'open', isInitial: true, weight: 10, color: '#64748b' },
  { code: 'qualified', name: { en: 'Qualified', pl: 'Zakwalifikowana' }, defaultName: 'Qualified', kind: 'open', isInitial: false, weight: 20, color: '#3b82f6' },
  { code: 'proposal', name: { en: 'Proposal', pl: 'Oferta' }, defaultName: 'Proposal', kind: 'open', isInitial: false, weight: 30, color: '#8b5cf6' },
  { code: 'negotiation', name: { en: 'Negotiation', pl: 'Negocjacje' }, defaultName: 'Negotiation', kind: 'open', isInitial: false, weight: 40, color: '#f59e0b' },
  { code: 'won', name: { en: 'Won', pl: 'Wygrana' }, defaultName: 'Won', kind: 'won', isInitial: false, weight: 90, color: '#10b981' },
  { code: 'lost', name: { en: 'Lost', pl: 'Przegrana' }, defaultName: 'Lost', kind: 'lost', isInitial: false, weight: 100, color: '#ef4444' },
];

const DEFAULT_TRANSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['new', 'qualified'],
  ['qualified', 'proposal'],
  ['proposal', 'negotiation'],
  ['negotiation', 'won'],
  ['proposal', 'won'],
  ['new', 'lost'],
  ['qualified', 'lost'],
  ['proposal', 'lost'],
  ['negotiation', 'lost'],
  ['lost', 'new'],
];

/**
 * Put the workflow configuration back to what the init migration seeds, and
 * drop every mapping and counting status. Opportunities are not touched: a
 * caller that needs none left creates its own and relies on the harness's
 * truncate for the rest.
 */
export async function restoreDefaultCrmWorkflow(em: EntityManager): Promise<void> {
  const conn = em.getConnection();
  await conn.execute('delete from "crm_order_status_mappings"');
  await conn.execute('delete from "crm_value_counting_statuses"');
  await conn.execute('delete from "crm_opportunity_status_transitions"');
  await conn.execute('delete from "crm_opportunity_statuses"');
  for (const status of DEFAULT_STATUSES) {
    await conn.execute(
      `insert into "crm_opportunity_statuses"
         ("id", "code", "name", "default_name", "kind", "is_initial", "weight", "color", "created_at", "updated_at")
       values (gen_random_uuid(), ?, ?::jsonb, ?, ?, ?, ?, ?, now(), now())`,
      [
        status.code,
        JSON.stringify(status.name),
        status.defaultName,
        status.kind,
        status.isInitial,
        status.weight,
        status.color,
      ],
    );
  }
  for (const [from, to] of DEFAULT_TRANSITIONS) {
    await conn.execute(
      `insert into "crm_opportunity_status_transitions" ("id", "from_status_code", "to_status_code", "created_at")
       values (gen_random_uuid(), ?, ?, now())`,
      [from, to],
    );
  }
}

/**
 * An Order of `organizationId`, in the Order workflow's start status (`new`).
 * Written straight to the table, as `orders`' own port test does: the subject
 * of the CRM tests is what happens to an Order that already exists.
 */
export async function seedCrmOrder(
  em: EntityManager,
  overrides: { organizationId?: string; status?: string } = {},
): Promise<{ id: string; businessId: string | null }> {
  const order = em.create(Order, {
    organizationId: overrides.organizationId ?? TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: randomUUID(),
    ...(overrides.status ? { status: overrides.status } : {}),
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'p', name: 'P', kind: 'bank_transfer', adapter: 'bank_transfer' },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return { id: order.id, businessId: order.businessId ?? null };
}

/** A second Organization with a row behind it — `crm_opportunities` has a real foreign key. */
export async function seedCrmOrganization(em: EntityManager, label: string): Promise<string> {
  const organization = em.create(Organization, {
    name: `CRM ${label} ${randomUUID().slice(0, 8)}`,
    taxId: `PL${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
  });
  await em.persistAndFlush(organization);
  return organization.id;
}

/**
 * An administrator holding exactly `permissions`, reaching every Organization
 * (any role other than the sales representative's does). Returns the session
 * cookie and an `undo` for `afterAll`.
 */
export async function seedCrmAdmin(
  em: EntityManager,
  label: string,
  permissions: string[],
): Promise<{ cookies: { b2b_session: string }; adminUserId: string; undo: () => void }> {
  const suffix = randomUUID().slice(0, 8);
  const role = em.create(AdminRole, {
    code: `crm_${label}_${suffix}`,
    name: `CRM ${label}`,
    permissions,
  });
  await em.persistAndFlush(role);
  return registerAdmin(em, role.id, `crm-${label}-${suffix}`);
}

/**
 * A Sales Representative confined to `organizationIds` — the allowed-set tenant
 * context — holding `permissions` on top of whatever the role already carries.
 * The role's code is the platform's own: it is what makes the scope narrow.
 */
export async function seedCrmSalesRep(
  em: EntityManager,
  organizationIds: string[],
  permissions: string[],
): Promise<{ cookies: { b2b_session: string }; adminUserId: string; undo: () => void }> {
  let role = await em.findOne(AdminRole, { code: 'sales_representative' });
  if (!role) {
    role = em.create(AdminRole, {
      code: 'sales_representative',
      name: 'Sales Representative',
      permissions,
    });
  } else {
    role.permissions = [...new Set([...role.permissions, ...permissions])];
  }
  await em.persistAndFlush(role);
  const admin = await registerAdmin(em, role.id, `crm-rep-${randomUUID().slice(0, 8)}`);
  for (const organizationId of organizationIds) {
    em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId: admin.adminUserId });
  }
  await em.flush();
  return admin;
}

async function registerAdmin(
  em: EntityManager,
  adminRoleId: string,
  slug: string,
): Promise<{ cookies: { b2b_session: string }; adminUserId: string; undo: () => void }> {
  const admin = em.create(AdminUser, {
    email: `${slug}@crm.local`,
    passwordHash: 'x'.repeat(60),
    adminRoleId,
    firstName: 'Crm',
    lastName: slug,
    status: 'active',
  });
  await em.persistAndFlush(admin);
  const cookie = `stub-${slug}`;
  ADMIN_COOKIES[cookie] = { adminUserId: admin.id };
  return {
    cookies: { b2b_session: cookie },
    adminUserId: admin.id,
    undo: () => {
      delete ADMIN_COOKIES[cookie];
    },
  };
}

/** `POST /opportunities` as the platform administrator; fails the test on anything but 201. */
export async function createCrmOpportunity(
  h: BackendServerHandle,
  body: Record<string, unknown> = {},
  cookies: Record<string, string> = CRM_ADMIN,
): Promise<{ id: string; number: string; version: number; status: { code: string } }> {
  const response = await h.app.inject({
    method: 'POST',
    url: `${CRM_API}/opportunities`,
    cookies,
    payload: { title: 'Fixture opportunity', organizationId: TEST_ORGANIZATION_ID, currency: 'PLN', ...body },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createCrmOpportunity: ${response.statusCode} ${response.body}`);
  }
  return (response.json() as { data: { id: string; number: string; version: number; status: { code: string } } }).data;
}

/** `POST /opportunities/:id/transition`; returns the raw response for the caller to judge. */
export function transitionCrmOpportunity(
  h: BackendServerHandle,
  opportunityId: string,
  to: string,
  cookies: Record<string, string> = CRM_ADMIN,
  reason?: string,
) {
  return h.app.inject({
    method: 'POST',
    url: `${CRM_API}/opportunities/${opportunityId}/transition`,
    cookies,
    payload: { to, ...(reason ? { reason } : {}) },
  });
}

/** `POST /opportunities/:id/links` for an Order. */
export function linkCrmOrder(
  h: BackendServerHandle,
  opportunityId: string,
  orderId: string,
  options: { syncStatus?: boolean; cookies?: Record<string, string> } = {},
) {
  return h.app.inject({
    method: 'POST',
    url: `${CRM_API}/opportunities/${opportunityId}/links`,
    cookies: options.cookies ?? CRM_ADMIN,
    payload: {
      documentKind: 'order',
      documentId: orderId,
      ...(options.syncStatus === undefined ? {} : { syncStatus: options.syncStatus }),
    },
  });
}

/** `PUT /order-status-mappings` with forward mappings `{ opportunityStatus: orderStatus }`. */
export function setCrmForwardMappings(h: BackendServerHandle, mappings: Record<string, string>) {
  return h.app.inject({
    method: 'PUT',
    url: `${CRM_API}/order-status-mappings`,
    cookies: CRM_ADMIN,
    payload: {
      mappings: Object.entries(mappings).map(([opportunityStatusCode, orderStatusCode]) => ({
        direction: 'opportunity_to_order',
        opportunityStatusCode,
        orderStatusCode,
      })),
    },
  });
}

/** `PUT /order-status-mappings` with the whole set, both directions, as given. */
export function setCrmMappings(
  h: BackendServerHandle,
  mappings: ReadonlyArray<{
    direction: 'opportunity_to_order' | 'order_to_opportunity';
    opportunityStatusCode: string;
    orderStatusCode: string;
    requireAllOrders?: boolean;
  }>,
) {
  return h.app.inject({
    method: 'PUT',
    url: `${CRM_API}/order-status-mappings`,
    cookies: CRM_ADMIN,
    payload: { mappings },
  });
}

/**
 * Change an Order's status through the **Orders admin endpoint** — the way an
 * operator does it — and wait until every subscriber of the resulting
 * `order.status_changed.v1` has finished.
 *
 * The bus dispatches to its handlers one after another and awaits each, so a
 * handler registered here, after the composed application's own, runs once
 * theirs have returned. That is what lets a test assert "nothing moved"
 * without sleeping.
 */
export async function changeOrderStatusAsOperator(
  h: BackendServerHandle,
  orderId: string,
  to: string,
): Promise<void> {
  let off: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    off = h.eventBus.on('order.status_changed.v1', (payload: unknown) => {
      const event = payload as { orderId?: string; to?: string };
      if (event.orderId === orderId && event.to === to) resolve();
    });
  });
  try {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      cookies: CRM_ADMIN,
      payload: { to },
    });
    if (response.statusCode !== 200) {
      throw new Error(`changeOrderStatusAsOperator: ${response.statusCode} ${response.body}`);
    }
    await settled;
  } finally {
    off();
  }
}

/**
 * Assign `adminUserId` to `organizationId` as its Sales Rep, as of `assignedAt`
 * — the row `organizations` keeps, written directly so a test can state which
 * assignment is the longest-standing.
 */
export async function assignCrmSalesRep(
  em: EntityManager,
  organizationId: string,
  adminUserId: string,
  assignedAt: Date = new Date(),
): Promise<void> {
  em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId, createdAt: assignedAt });
  await em.flush();
}

/**
 * Drop every CRM tag (and, by cascade, every tagging). `crm_tags` is platform
 * configuration that hangs off nothing the harness truncates, so a file that
 * creates tags clears them in `beforeAll` and `afterAll`, for the reason
 * {@link restoreDefaultCrmWorkflow} is called in both.
 */
export async function clearCrmTags(em: EntityManager): Promise<void> {
  await em.getConnection().execute('delete from "crm_tags"');
}

/** `POST /tags` as the platform administrator; fails the test on anything but 201. */
export async function createCrmTag(
  h: BackendServerHandle,
  name: string,
  color?: string,
): Promise<{ id: string; name: string; color: string; usageCount: number }> {
  const response = await h.app.inject({
    method: 'POST',
    url: `${CRM_API}/tags`,
    cookies: CRM_ADMIN,
    payload: { name, ...(color ? { color } : {}) },
  });
  if (response.statusCode !== 201) throw new Error(`createCrmTag: ${response.statusCode} ${response.body}`);
  return (response.json() as { data: { id: string; name: string; color: string; usageCount: number } }).data;
}

/**
 * A file in the media library, as an upload leaves it — written straight to
 * `assets`, as the library's own reference tests do: the subject of the CRM
 * tests is what an Opportunity does with a file that already exists. `private`
 * unless said otherwise, which is what an attachment has to be.
 */
export async function seedCrmAsset(
  em: EntityManager,
  overrides: { visibility?: 'public' | 'private'; filename?: string; mimeType?: string; sizeBytes?: number } = {},
): Promise<{ id: string; filename: string; mimeType: string; sizeBytes: number }> {
  const id = randomUUID();
  const filename = overrides.filename ?? `brief-${id.slice(0, 8)}.pdf`;
  const mimeType = overrides.mimeType ?? 'application/pdf';
  const sizeBytes = overrides.sizeBytes ?? 2048;
  const locator = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.pdf`;
  await em.getConnection().execute(
    `insert into "assets"
       ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
        "storage_backend", "storage_locator", "created_at", "updated_at")
     values (?, 'pdf', ?, ?, ?, ?, ?, 'local', ?, now(), now())`,
    [id, filename, mimeType, sizeBytes, locator, overrides.visibility ?? 'private', locator],
  );
  return { id, filename, mimeType, sizeBytes };
}

/** Remove fixture assets: `assets` hangs off nothing the harness truncates. */
export async function removeCrmAssets(em: EntityManager, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await em
    .getConnection()
    .execute(`delete from "assets" where "id" in (${ids.map(() => '?').join(', ')})`, [...ids]);
}

/** Take an Organization back from a Sales Rep: they no longer reach it. */
export async function unassignCrmSalesRep(
  em: EntityManager,
  organizationId: string,
  adminUserId: string,
): Promise<void> {
  await em.nativeDelete(OrganizationSalesRepAssignment, { organizationId, adminUserId });
}
