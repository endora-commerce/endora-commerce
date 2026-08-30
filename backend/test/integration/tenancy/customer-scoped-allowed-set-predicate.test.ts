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
  PushSubscription,
} from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  ensureSalesChannelId,
  systemDefaultSalesChannelId,
} from '../../helpers/sales-channel-fixtures.js';
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
  const pushSubscriptions: Record<string, string> = {};
  /**
   * A channel of this file's own, for the `pwa` cases. The subscription admin
   * surface answers with **counts** rather than rows, so an assertion over the
   * platform's own numbers would be a claim about every other file's fixtures
   * (`check:shared-table-wipes`' rule). A channel nothing else writes to makes
   * the count exactly the rows created below.
   */
  let pushChannelId: string;

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
    // `inventory:read` / `inventory:write` replaced the borrowed `orders:read` /
    // `catalog:write` on the availability-notification routes in f8ffc575a
    // ("two modules own their authority"), which landed while this file was on
    // its branch. Without them the representative is refused at the gate — 403
    // rather than the 200-with-no-row and the 404 the two cases assert — so the
    // predicate they exist to exercise is never reached. The borrowed codes stay
    // in the list: this file's other cases were written against them and a
    // narrowing here is not this merge request's.
    const grants = [
      'comparisons:read',
      'newsletter:read',
      'newsletter:write',
      'orders:read',
      'orders:write',
      'catalog:write',
      'carts:read',
      'inventory:read',
      'inventory:write',
      // Feature 087 Group B / D-187 — `pwa`'s subscription surface, which
      // starts granting for this representative the moment
      // `push_subscriptions` carries its organisation.
      'pwa:read',
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
    pushChannelId = await ensureSalesChannelId(em, `pred-push-${stamp}`);

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
        // Feature 087 Group B / D-187 — `comparisons` carries its organisation
        // and `comparisons_organization_attribution_chk` refuses an owned row
        // without one. This is the stamp `ComparisonService` writes on the
        // owned-create path, done by hand because the fixture writes the row
        // directly.
        organizationId,
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

      // One subscribed device per organisation (feature 087 Group B, D-187).
      // The organisation is written beside the account because
      // `push_subscriptions_organization_attribution_chk` requires it — this
      // fixture cannot express the row the column exists to make visible
      // without also expressing the attribution.
      const subscription = em.create(PushSubscription, {
        salesChannelId: pushChannelId,
        customerAccountId: account.id,
        organizationId,
        endpoint: `https://push.audit.local/predicate-${key}-${stamp}`,
        p256dh: 'p',
        auth: 'a',
        status: 'active',
      });
      await em.persistAndFlush(subscription);
      pushSubscriptions[key] = subscription.id;
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

  it('lists a comparison owned inside the scope', async () => {
    // The granting half, and the reason it has to be asserted beside the two
    // refusals above them: a filter that refused everybody would pass both, and
    // did — until feature 087 Group B gave this table its `organization_id`,
    // `customerFilterCond`'s `allowed-set` arm matched nothing here at all, so
    // the representative's own customer's comparison was as invisible as the
    // foreign one. The pair is what tells "scoped" from "blank".
    const res = await asRep('GET', '/api/v1/admin/comparisons?limit=100');
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).toContain(comparisons['own']);
    expect(ids).not.toContain(comparisons['foreign']);
  });

  it('serves the detail of a comparison owned inside the scope', async () => {
    const res = await asRep('GET', `/api/v1/admin/comparisons/${comparisons['own']}`);
    expect(res.statusCode).toBe(200);
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

  // ── PushSubscription ───────────────────────────────────────────────────

  /**
   * The **granting** half, and the one the other cases in this file cannot
   * show. Every assertion above is a refusal, and a filter that refused
   * everything would satisfy all of them; `push_subscriptions` carries its
   * organisation since D-187, so this representative is entitled to an answer
   * rather than to silence, and the shape of that answer is the whole point of
   * the column.
   *
   * It reads a **count**, because that is what this surface answers. The
   * channel is this file's own (see `pushChannelId`), so the number is exactly
   * the two rows the fixture created and never a claim about the platform.
   */
  it('counts only the subscribed devices of the assigned organization', async () => {
    const res = await asRep(
      'GET',
      `/api/v1/admin/pwa/subscriptions?salesChannelId=${pushChannelId}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ active: 1, invalid: 0 });
  });

  it('shows a platform administrator the devices of both organizations', async () => {
    // The control. Without it, a filter that had gone back to refusing the
    // table whole would pass the case above by answering zero — and zero is
    // one away from one.
    const res = await asPlatformAdmin(
      'GET',
      `/api/v1/admin/pwa/subscriptions?salesChannelId=${pushChannelId}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ active: 2, invalid: 0 });
  });

  it('does not disclose a subscribed device to a representative with no assignment', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/pwa/subscriptions?salesChannelId=${pushChannelId}`,
      cookies: { b2b_session: unassignedRepCookie },
    });
    expect(res.statusCode).toBe(200);
    // An empty allowed set is `$in: []` on the organisation column, which
    // matches nothing — the same answer it gives on every `@OrgScoped` entity
    // (FR-007), where before the column it gave the opposite one.
    expect(res.json()).toEqual({ active: 0, invalid: 0 });
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

  // ── The filter itself, on the entities that carry the column ───────────

  it('confines a `Cart` read to the assigned organizations with no help from the surface', async () => {
    // `carts` was the first `@CustomerScoped` class to carry `organization_id`,
    // so it is one of those whose `allowed-set` arm **grants** rather than
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

  it('confines a `Comparison` read to the assigned organizations, on the same EntityManager', async () => {
    // The same assertion for `comparisons`, which gained its column in feature
    // 087 Group B (B1, D-187). This case used to be the *refusal* one — with no
    // column, a scoped actor assigned to **both** organizations still saw
    // neither row — and it is the same three lines with the answer inverted,
    // which is the whole shape of what a column buys.
    //
    // It enters at the EntityManager for the reason the `Cart` case above does:
    // the two route cases assert refusals, so a `customerOrganizationColumn`
    // that regressed to `absent` would leave them green while every comparison
    // screen went blank for a sales representative.
    const scoped = resolveTenantContext(
      { kind: 'admin', adminUserId: 'irrelevant-the-scope-is-passed' },
      { allowAll: false, allowedOrganizationIds: [assignedOrgId] },
    );
    const ids = await runWithTenantContext(scoped, async () => {
      h.em().clear();
      const rows = await h
        .em()
        .find(Comparison, { id: { $in: [comparisons['own']!, comparisons['foreign']!] } });
      return rows.map((c) => c.id);
    });
    expect(ids).toContain(comparisons['own']);
    expect(ids).not.toContain(comparisons['foreign']);
  });

  it('refuses a column-less `@CustomerScoped` read outright, on the same EntityManager', async () => {
    const scoped = resolveTenantContext(
      { kind: 'admin', adminUserId: 'irrelevant-the-scope-is-passed' },
      { allowAll: false, allowedOrganizationIds: [assignedOrgId, foreignOrgId] },
    );
    const ids = await runWithTenantContext(scoped, async () => {
      h.em().clear();
      const rows = await h.em().find(NewsletterSubscriber, {
        id: { $in: [subscribers['own-read']!, subscribers['foreign-read']!] },
      });
      return rows.map((s) => s.id);
    });
    // Both organizations are assigned, and the answer is still nothing:
    // `newsletter_subscribers` carries no `organization_id`, so no row in it is
    // inside any scoped actor's authority (FR-011). It stops being nothing when
    // feature 087 Group B gives that table its column — with no further edit to
    // the filter. `Comparison` stood here until B1 landed, and this is what its
    // case looked like.
    expect(ids).toEqual([]);
  });

  // ── A caller-supplied tenant identity on a write ───────────────────────

  it('refuses building a quick order on behalf of a customer outside the scope, writing nothing', async () => {
    // A second finding of a different kind, and the filter cannot reach it:
    // MikroORM applies a global filter to SELECT, UPDATE and DELETE and **not
    // to INSERT**, so a route that takes the tenant identity from its own
    // request body writes wherever the body says. `onBehalfOf` is exactly that
    // — `{ customerAccountId, organizationId }`, straight into
    // `cartWritePort.getOrCreateForCustomer` and `rfqService.createForCustomer`.
    //
    // `[M]` Measured on master, and again with the filter in place and this
    // guard absent: a representative assigned to one organization created a
    // cart row on a customer account in another. The predicate changes what
    // the follow-up *read* sees and not what the insert writes, so without a
    // guard the operation half-completes and leaves the row behind.
    const before = await h.em().count(Cart, { customerAccountId: accounts['foreign']! });
    const res = await asRep('POST', '/api/v1/admin/quick-order/build', {
      target: 'cart',
      onBehalfOf: {
        customerAccountId: accounts['foreign'],
        organizationId: foreignOrgId,
      },
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    });
    expect(res.statusCode).toBe(404);
    h.em().clear();
    expect(await h.em().count(Cart, { customerAccountId: accounts['foreign']! })).toBe(before);
  });

  it('leaves the same build working for a customer inside the scope', async () => {
    const res = await asRep('POST', '/api/v1/admin/quick-order/build', {
      target: 'cart',
      onBehalfOf: {
        customerAccountId: accounts['own'],
        organizationId: assignedOrgId,
      },
      items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
    });
    expect(res.statusCode).toBe(200);
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
