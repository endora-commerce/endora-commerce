import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminRole,
  AdminUser,
  AvailabilityNotification,
  Cart,
  Comparison,
  CustomerAccount,
  NewsletterSubscriber,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { resolveTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';

/**
 * `@CustomerScoped` rows are not disclosed to an administrator whose authority
 * is a set of organizations.
 *
 * This is feature 087's FR-001/FR-007 asserted at the entry points, and it is
 * the half `test/integration/tenancy/customer-scoped-allowed-set.test.ts` does
 * not cover: that file asserts the two surfaces (`carts`, `customers`) that
 * were repaired **by hand** in !932/!936, and it passes because those two
 * services scope themselves. Everything else backed by one of the sixteen
 * `@CustomerScoped` classes has no such repair, because `customerFilterCond`
 * returned `{}` for the `allowed-set` mode — no predicate at all — so the guard
 * ran, returned successfully and enforced nothing.
 *
 * Every disclosure case here enters through the route an operator's browser
 * calls. None of them calls the filter with a hand-built argument: a fixture
 * that enters below the defect cannot catch it, and this is the population
 * where that matters most. The two cases that do not enter at a route enter one
 * layer in — the resolved `EntityManager`, inside a context the **production**
 * `resolveTenantContext` built — because `Cart` is guarded by its own surface
 * as well, so no route over it can show whether the filter contributed
 * anything.
 *
 * **What each case asserts is the property, not the mechanism** — a row owned
 * by a customer account in an organization the caller is not assigned to is
 * not reachable. It stays true when the fifteen column-less classes gain their
 * own `organization_id` (feature 087, Group A/B) and the answer widens from
 * "the caller sees none of these rows" to "the caller sees their own". Both
 * directions run: a guard that refuses everybody would pass the out-of-scope
 * half on its own, so the platform administrator must still reach both rows.
 */
describe('@CustomerScoped rows are not disclosed to an allowed-set administrator', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let unassignedRepCookie: string;
  let assignedOrgId: string;
  let foreignOrgId: string;

  const accounts: Record<string, string> = {};
  const comparisons: Record<string, string> = {};
  const subscribers: Record<string, string> = {};
  const notifications: Record<string, string> = {};
  const carts: Record<string, string> = {};

  const stamp = Date.now();

  const newOrganization = (em: EntityManager, name: string, suffix: string): Organization =>
    em.create(Organization, {
      name,
      taxId: `PLPRED${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Predykatu 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });

  const newRep = async (
    em: EntityManager,
    roleId: string,
    label: string,
  ): Promise<string> => {
    const rep = em.create(AdminUser, {
      email: `predicate-${label}-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: roleId,
      firstName: 'Predicate',
      lastName: label,
    });
    await em.persistAndFlush(rep);
    return rep.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // `resolveAdminOrdersScope` keys on this exact role code, so the fixture
    // cannot use a code of its own. Another file in the run may have created
    // it already with a narrower grant set — widen that one rather than
    // creating a second row the unique index would refuse.
    const grants = [
      'comparisons:read',
      'newsletter:read',
      'newsletter:write',
      'orders:read',
      'catalog:write',
      'carts:read',
    ];
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: grants,
      });
    } else {
      role.permissions = Array.from(new Set([...role.permissions, ...grants]));
    }
    await em.persistAndFlush(role);

    const assigned = newOrganization(em, 'Predicate assigned org', 'A');
    const foreign = newOrganization(em, 'Predicate foreign org', 'F');
    await em.persistAndFlush([assigned, foreign]);
    assignedOrgId = assigned.id;
    foreignOrgId = foreign.id;

    const repId = await newRep(em, role.id, 'assigned');
    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assignedOrgId,
        adminUserId: repId,
      }),
    );

    // A second representative with the same role and **no** assignment at all.
    // Their allowed set is empty, which on every `@OrgScoped` entity means
    // "matches nothing" (`$in: []`) and on a `@CustomerScoped` one meant
    // "matches everything" — the same actor, opposite answers (FR-007).
    const unassignedRepId = await newRep(em, role.id, 'unassigned');

    const salesChannelId = await systemDefaultSalesChannelId(em);

    for (const key of ['own', 'foreign'] as const) {
      const organizationId = key === 'own' ? assignedOrgId : foreignOrgId;
      const account = em.create(CustomerAccount, {
        organizationId,
        email: `predicate-${key}-${stamp}@audit.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Predicate',
        lastName: key,
      });
      await em.persistAndFlush(account);
      accounts[key] = account.id;

      const comparison = em.create(Comparison, {
        shareToken: `pred${key}${String(stamp).slice(-10)}`.slice(0, 32),
        customerAccountId: account.id,
        salesChannelId,
        displayMode: 'all',
      });
      await em.persistAndFlush(comparison);
      comparisons[key] = comparison.id;

      // One row per read assertion and one per write, so a write case that is
      // still leaking cannot remove the row a read case reads back — the
      // `DELETE` below really does delete, on `master`.
      for (const purpose of ['read', 'reject'] as const) {
        const subscriber = em.create(NewsletterSubscriber, {
          email: `predicate-sub-${key}-${purpose}-${stamp}@audit.local`,
          status: 'active',
          customerAccountId: account.id,
          salesChannelId,
        });
        await em.persistAndFlush(subscriber);
        subscribers[`${key}-${purpose}`] = subscriber.id;

        const notification = em.create(AvailabilityNotification, {
          productId: '00000000-0000-4000-8000-00000000f001',
          customerAccountId: account.id,
          email: `predicate-notify-${key}-${purpose}-${stamp}@audit.local`,
          status: 'queued',
        });
        await em.persistAndFlush(notification);
        notifications[`${key}-${purpose}`] = notification.id;
      }

      const cart = em.create(Cart, {
        customerAccountId: account.id,
        organizationId,
        status: 'active',
      });
      await em.persistAndFlush(cart);
      carts[key] = cart.id;
    }

    repCookie = `stub-predicate-rep-${stamp}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: repId };
    unassignedRepCookie = `stub-predicate-unassigned-${stamp}`;
    ADMIN_COOKIES[unassignedRepCookie] = { adminUserId: unassignedRepId };
  }, 120_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    delete ADMIN_COOKIES[unassignedRepCookie];
    await teardownBackendServer(h);
  });

  const asRep = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    h.app.inject({
      method,
      url,
      cookies: { b2b_session: repCookie },
      ...(payload === undefined ? {} : { payload }),
    });

  const asPlatformAdmin = async (method: 'GET', url: string) =>
    h.app.inject({ method, url, cookies: { b2b_session: 'stub-admin-session' } });

  // ── Comparison ─────────────────────────────────────────────────────────

  it('does not list a comparison owned outside the scope', async () => {
    const res = await asRep('GET', '/api/v1/admin/comparisons?limit=100');
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).not.toContain(comparisons['foreign']);
  });

  it('refuses the detail of a comparison owned outside the scope', async () => {
    const res = await asRep('GET', `/api/v1/admin/comparisons/${comparisons['foreign']}`);
    expect(res.statusCode).toBe(404);
  });

  // ── NewsletterSubscriber ───────────────────────────────────────────────

  it('does not list a newsletter subscriber owned outside the scope', async () => {
    const res = await asRep('GET', '/api/v1/admin/newsletter/subscribers?page=1&pageSize=200');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(`predicate-sub-foreign-read-${stamp}@audit.local`);
  });

  it('does not export a newsletter subscriber owned outside the scope', async () => {
    const res = await asRep('GET', '/api/v1/admin/newsletter/subscribers/export');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(`predicate-sub-foreign-read-${stamp}@audit.local`);
  });

  it('refuses the detail of a newsletter subscriber owned outside the scope', async () => {
    const res = await asRep(
      'GET',
      `/api/v1/admin/newsletter/subscribers/${subscribers['foreign-read']}`,
    );
    expect(res.statusCode).toBe(404);
  });

  it('refuses deactivating a newsletter subscriber outside the scope, writing nothing', async () => {
    const id = subscribers['foreign-reject']!;
    const before = await h.em().findOne(NewsletterSubscriber, { id });
    const res = await asRep(
      'POST',
      `/api/v1/admin/newsletter/subscribers/${id}/deactivate`,
      { expectedVersion: before!.version },
    );
    expect(res.statusCode).toBe(404);
    h.em().clear();
    expect((await h.em().findOne(NewsletterSubscriber, { id }))?.status).toBe('active');
  });

  it('refuses deleting a newsletter subscriber outside the scope, writing nothing', async () => {
    const id = subscribers['foreign-reject']!;
    const res = await asRep('DELETE', `/api/v1/admin/newsletter/subscribers/${id}`);
    expect(res.statusCode).toBe(404);
    h.em().clear();
    expect(await h.em().findOne(NewsletterSubscriber, { id })).not.toBeNull();
  });

  // ── AvailabilityNotification ───────────────────────────────────────────

  it('does not list an availability notification owned outside the scope', async () => {
    const res = await asRep(
      'GET',
      '/api/v1/admin/inventory/availability-notifications?pageSize=200',
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(`predicate-notify-foreign-read-${stamp}@audit.local`);
  });

  it('refuses cancelling an availability notification outside the scope, writing nothing', async () => {
    const id = notifications['foreign-reject']!;
    const res = await asRep(
      'PATCH',
      `/api/v1/admin/inventory/availability-notifications/${id}`,
      { status: 'cancelled' },
    );
    expect(res.statusCode).toBe(404);
    h.em().clear();
    expect((await h.em().findOne(AvailabilityNotification, { id }))?.status).toBe('queued');
  });

  // ── The empty allowed-set (FR-007) ─────────────────────────────────────

  it('discloses nothing to a representative with no assignment at all', async () => {
    const comparisonList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/comparisons?limit=100',
      cookies: { b2b_session: unassignedRepCookie },
    });
    expect(comparisonList.statusCode).toBe(200);
    const ids = (comparisonList.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).not.toContain(comparisons['own']);
    expect(ids).not.toContain(comparisons['foreign']);

    const cartList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/carts?pageSize=200',
      cookies: { b2b_session: unassignedRepCookie },
    });
    expect(cartList.statusCode).toBe(200);
    const cartIds = (cartList.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(cartIds).not.toContain(carts['own']);
    expect(cartIds).not.toContain(carts['foreign']);
  });

  // ── The filter itself, on the entity that already carries the column ───

  it('confines a `Cart` read to the assigned organizations with no help from the surface', async () => {
    // `carts` is the one `@CustomerScoped` class carrying `organization_id`
    // today, so it is the one whose `allowed-set` arm **grants** rather than
    // refuses — and `CartAdminService` guards itself, which means no route can
    // show whether the filter did anything. This enters one layer in instead:
    // the resolved EntityManager, inside a context built by the production
    // `resolveTenantContext` from the production actor shape, with a `where`
    // that names nothing but the two cart ids.
    //
    // It is the assertion that catches a derivation gone wrong. If
    // `customerOrganizationColumn` ever answered `absent` for `Cart`, every
    // route test above would still pass — they assert refusals — while every
    // cart screen quietly went blank for a sales representative.
    const scoped = resolveTenantContext(
      { kind: 'admin', adminUserId: 'irrelevant-the-scope-is-passed' },
      { allowAll: false, allowedOrganizationIds: [assignedOrgId] },
    );
    const ids = await runWithTenantContext(scoped, async () => {
      h.em().clear();
      const rows = await h.em().find(Cart, { id: { $in: [carts['own']!, carts['foreign']!] } });
      return rows.map((c) => c.id);
    });
    expect(ids).toContain(carts['own']);
    expect(ids).not.toContain(carts['foreign']);
  });

  it('refuses a column-less `@CustomerScoped` read outright, on the same EntityManager', async () => {
    const scoped = resolveTenantContext(
      { kind: 'admin', adminUserId: 'irrelevant-the-scope-is-passed' },
      { allowAll: false, allowedOrganizationIds: [assignedOrgId, foreignOrgId] },
    );
    const ids = await runWithTenantContext(scoped, async () => {
      h.em().clear();
      const rows = await h
        .em()
        .find(Comparison, { id: { $in: [comparisons['own']!, comparisons['foreign']!] } });
      return rows.map((c) => c.id);
    });
    // Both organizations are assigned, and the answer is still nothing:
    // `comparisons` carries no `organization_id`, so no row in it is inside any
    // scoped actor's authority (FR-011). It stops being nothing when feature
    // 087 gives the table its column — with no further edit to the filter.
    expect(ids).toEqual([]);
  });

  // ── The other direction ────────────────────────────────────────────────

  it('leaves a platform administrator reaching both organizations', async () => {
    const comparison = await asPlatformAdmin(
      'GET',
      `/api/v1/admin/comparisons/${comparisons['foreign']}`,
    );
    expect(comparison.statusCode).toBe(200);

    const subscriber = await asPlatformAdmin(
      'GET',
      `/api/v1/admin/newsletter/subscribers/${subscribers['foreign-read']}`,
    );
    expect(subscriber.statusCode).toBe(200);

    const notificationList = await asPlatformAdmin(
      'GET',
      '/api/v1/admin/inventory/availability-notifications?pageSize=200',
    );
    expect(notificationList.statusCode).toBe(200);
    expect(notificationList.body).toContain(`predicate-notify-foreign-read-${stamp}@audit.local`);

    const csv = await asPlatformAdmin('GET', '/api/v1/admin/newsletter/subscribers/export');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(`predicate-sub-foreign-read-${stamp}@audit.local`);
  });
});
