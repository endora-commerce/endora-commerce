import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminRole,
  AdminUser,
  AvailabilityNotification,
  Comparison,
  CustomerAccount,
  NewsletterSubscriber,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * An empty screen says why it is empty (feature 087, owner decision of
 * 2026-08-29).
 *
 * `customer-scoped-allowed-set-predicate.test.ts` asserts that a sales
 * representative is shown none of these rows, and that is the correct answer.
 * This file asserts the other half of the same answer: that they are **told**,
 * because `[]` and "there is nothing here" are the same three bytes and an
 * operator reading the first concludes the second — a false statement about the
 * data, which is exactly the shape this project has repaired four times
 * elsewhere ("a field that says `false` when it means I cannot tell").
 *
 * Both directions run in every case, and the second is the one that keeps the
 * first honest: a disclosure attached to everybody would satisfy every
 * assertion below about the representative while telling a platform
 * administrator, over a screen full of rows, that there is something they
 * cannot see.
 *
 * Nothing here reads the filter, the context or any internal: every case enters
 * at the route an operator's browser calls and asserts the body it receives.
 * The predicate is untouched by this feature — if a case in the file beside
 * this one moves, that is the thing that was not supposed to happen.
 */
describe('a scoped administrator is told why these lists are empty', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let assignedOrgId: string;

  const stamp = Date.now();
  let ownEmail: string;
  let ownNotifyEmail: string;
  let ownComparisonId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // `resolveAdminOrdersScope` keys on this exact role code, so the fixture
    // cannot invent one, and the row is therefore shared with every other file
    // in the run. Widen it rather than creating a second one the unique index
    // would refuse — and widen it with codes this file's own cases need and
    // nothing more. A grant added here that another file's cases quietly depend
    // on would make that file's green a property of the run order.
    const grants = ['comparisons:read', 'newsletter:read', 'inventory:read', 'orders:read'];
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

    const organization = em.create(Organization, {
      name: 'Notice assigned org',
      taxId: `PLNOTE${String(stamp).slice(-8)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Wyjaśnienia 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    assignedOrgId = organization.id;

    const rep = em.create(AdminUser, {
      email: `notice-rep-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Notice',
      lastName: 'Rep',
    });
    await em.persistAndFlush(rep);
    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assignedOrgId,
        adminUserId: rep.id,
      }),
    );

    const salesChannelId = await systemDefaultSalesChannelId(em);

    // A row in the representative's **own** organization, which is what makes
    // the refusal worth explaining: it is not that these records belong to
    // somebody else, it is that they belong to nobody the platform can name.
    const account = em.create(CustomerAccount, {
      organizationId: assignedOrgId,
      email: `notice-customer-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Notice',
      lastName: 'Customer',
    });
    await em.persistAndFlush(account);

    // Feature 087 Group B / D-187 — `comparisons` carries its organisation, so
    // this row is *attributed* and the notice below is not emitted for it. It
    // is here as the standing proof of the other half: the disclosure retires
    // per class, and this class has retired it. The stamp is also mandatory —
    // `comparisons_organization_attribution_chk` refuses an owned row without
    // one.
    const comparison = em.create(Comparison, {
      shareToken: `note${String(stamp).slice(-10)}`.slice(0, 32),
      customerAccountId: account.id,
      organizationId: assignedOrgId,
      salesChannelId,
      displayMode: 'all',
    });
    await em.persistAndFlush(comparison);
    ownComparisonId = comparison.id;

    ownEmail = `notice-sub-${stamp}@audit.local`;
    await em.persistAndFlush(
      em.create(NewsletterSubscriber, {
        email: ownEmail,
        status: 'active',
        customerAccountId: account.id,
        salesChannelId,
      }),
    );

    // Feature 087 Group B / D-187 — `availability_notifications` carries its
    // organisation, so this row is *attributed* and the notice below is not
    // emitted for it. The stamp is also mandatory:
    // `availability_notifications_organization_attribution_chk` refuses an
    // owned row without one.
    ownNotifyEmail = `notice-notify-${stamp}@audit.local`;
    await em.persistAndFlush(
      em.create(AvailabilityNotification, {
        productId: '00000000-0000-4000-8000-00000000f001',
        customerAccountId: account.id,
        organizationId: assignedOrgId,
        email: ownNotifyEmail,
        status: 'queued',
      }),
    );

    repCookie = `stub-notice-rep-${stamp}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
  }, 120_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  const asRep = (url: string) =>
    h.app.inject({ method: 'GET', url, cookies: { b2b_session: repCookie } });

  const asPlatformAdmin = (url: string) =>
    h.app.inject({ method: 'GET', url, cookies: { b2b_session: 'stub-admin-session' } });

  const noticeOf = (res: { json: () => unknown }): unknown =>
    (res.json() as { meta?: { scopeNotice?: unknown } }).meta?.scopeNotice;

  // ── /comparisons ───────────────────────────────────────────────────────

  it('has stopped explaining `/comparisons`, and shows the representative the row instead', async () => {
    // The notice **retires itself**, per class, the day that class gains its
    // `organization_id` — `scoped-empty-notice.md`'s third property, and this
    // is the first class to exercise it (feature 087 Group B / B1, D-187).
    //
    // This case is deliberately the old one inverted rather than deleted. The
    // notice is emitted by the *refusing* arm of `customerFilterCond`, so
    // "there is no notice" and "this screen is still refused whole and has
    // stopped saying so" are the same absence — which is the failure D-187
    // exists to prevent. Asserting the row arrives is what tells them apart.
    const res = await asRep('/api/v1/admin/comparisons?limit=100');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string }>;
      meta: Record<string, unknown>;
    };
    expect(body.data.map((c) => c.id)).toContain(ownComparisonId);
    expect(body.meta).not.toHaveProperty('scopeNotice');
    // The pagination the screen already reads is untouched by any of this.
    expect(body.meta).toHaveProperty('limit');
    expect(body.meta).toHaveProperty('nextCursor');
  });

  it('tells a platform administrator nothing, and shows them the rows', async () => {
    const res = await asPlatformAdmin('/api/v1/admin/comparisons?limit=100');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta).not.toHaveProperty('scopeNotice');
  });

  // ── /newsletter/subscribers ────────────────────────────────────────────

  it('tells the representative why `/newsletter/subscribers` is empty', async () => {
    const res = await asRep('/api/v1/admin/newsletter/subscribers?page=1&pageSize=200');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: unknown[]; total: number } };
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(noticeOf(res)).toBe('ORGANIZATION_ATTRIBUTION_PENDING');
  });

  it('tells a platform administrator nothing about the subscriber list', async () => {
    const res = await asPlatformAdmin('/api/v1/admin/newsletter/subscribers?page=1&pageSize=200');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(ownEmail);
    expect(noticeOf(res)).toBeUndefined();
  });

  // ── /inventory/availability-notifications ──────────────────────────────

  it('has stopped explaining the availability queue, and shows the representative the row instead', async () => {
    // The notice **retires itself**, per class, the day that class gains its
    // `organization_id` — `scoped-empty-notice.md`'s third property. This is
    // the second class in this file to exercise it (feature 087 Group B / B3,
    // D-187); `/comparisons` above was the first.
    //
    // Inverted rather than deleted, for the reason the `/comparisons` case
    // gives: the notice is emitted by the *refusing* arm of
    // `customerFilterCond`, so "there is no notice" and "this screen is still
    // refused whole and has stopped saying so" are the same absence. Asserting
    // the row arrives is what tells them apart.
    const res = await asRep('/api/v1/admin/inventory/availability-notifications?pageSize=200');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ email: string }>; total: number };
    expect(body.items.map((i) => i.email)).toContain(ownNotifyEmail);
    expect(noticeOf(res)).toBeUndefined();
  });

  it('tells a platform administrator nothing about the availability queue', async () => {
    const res = await asPlatformAdmin(
      '/api/v1/admin/inventory/availability-notifications?pageSize=200',
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(noticeOf(res)).toBeUndefined();
  });

  // ── The shapes that must stay untouched ────────────────────────────────

  it('leaves the subscriber CSV export a CSV', async () => {
    const res = await asRep('/api/v1/admin/newsletter/subscribers/export');
    expect(res.statusCode).toBe(200);
    // The body is a string, so there is no envelope to disclose on. A download
    // that grew a JSON tail would be a corrupt file, which is worse than the
    // silence this feature exists to fix.
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('{')).toBe(false);
  });

  it('leaves a refusal a refusal', async () => {
    // A 404 already says why. A notice about emptiness on top of it would be
    // noise, and `@endora-commerce/api-client` reads the error envelope by
    // shape.
    const res = await asRep('/api/v1/admin/comparisons/00000000-0000-4000-8000-0000000000ff');
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty('meta');
  });
});
