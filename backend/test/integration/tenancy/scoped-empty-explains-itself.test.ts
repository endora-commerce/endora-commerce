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
 *
 * ## Every case in this file has now retired, and the file has not
 *
 * The disclosure retires **per class**, the day that class gains its
 * `organization_id`, and with feature 087 Group B complete (D-187) all three
 * of the screens below have. So the file's cases are the *inverted* ones —
 * each asserting that the row arrives and that no notice is emitted — and the
 * reason they were inverted rather than deleted is the same in all three
 * places: the notice comes from the *refusing* arm of `customerFilterCond`, so
 * "there is no notice" and "this screen is still refused whole and has stopped
 * saying so" are the same absence, and only the row arriving tells them apart.
 *
 * That leaves the disclosure itself with no end-to-end assertion anywhere, and
 * it is written down here rather than discovered later. The eleven
 * `@CustomerScoped` classes still without the column are Group A's and none of
 * them has an admin list a sales representative reads, so there is no surface
 * left in this repository over which the notice can be observed. Its machinery
 * is covered at the unit level — `test/unit/tenancy/scope-notice.test.ts`,
 * `test/unit/kernel/request-scope-notice.test.ts`, and
 * `test/unit/tenancy/tenant-context.test.ts`'s `customerFilterCond('absent')`
 * cases — and the first Group A class to land both a column and a surface is
 * where the end-to-end half belongs again.
 */
describe('a scoped administrator is shown these lists, and told nothing about them', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let assignedOrgId: string;

  const stamp = Date.now();
  let ownEmail: string;
  let ownerlessEmail: string;
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

    // Feature 087 Group B / D-187 — `newsletter_subscribers` carries its
    // organisation, so this row is *attributed* and the notice below is not
    // emitted for it. The stamp is also mandatory:
    // `newsletter_subscribers_organization_attribution_chk` refuses an owned
    // row without one.
    ownEmail = `notice-sub-${stamp}@audit.local`;
    await em.persistAndFlush(
      em.create(NewsletterSubscriber, {
        email: ownEmail,
        status: 'active',
        customerAccountId: account.id,
        organizationId: assignedOrgId,
        salesChannelId,
      }),
    );

    // And one that belongs to nobody, which on this table is the ordinary case
    // rather than the edge: `POST /api/v1/newsletter/subscribe` names no
    // account, so every storefront sign-up is such a row. It is here to make
    // the *new* shape of the export visible — see the CSV case below.
    ownerlessEmail = `notice-ownerless-${stamp}@audit.local`;
    await em.persistAndFlush(
      em.create(NewsletterSubscriber, {
        email: ownerlessEmail,
        status: 'active',
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

  it('has stopped explaining `/newsletter/subscribers`, and shows the representative the row instead', async () => {
    // The notice **retires itself**, per class, the day that class gains its
    // `organization_id` — `scoped-empty-notice.md`'s third property. This is
    // the third and **last** class in this file to exercise it (feature 087
    // Group B / B4, D-187), so with this case inverted the file holds no
    // `ORGANIZATION_ATTRIBUTION_PENDING` assertion at all. That is not a gap
    // this merge request can close: the eleven `@CustomerScoped` classes still
    // without the column are Group A's, and none of them has an admin list a
    // sales representative reads. The disclosure's own machinery keeps its
    // proofs in `test/unit/tenancy/scope-notice.test.ts` and
    // `test/unit/kernel/request-scope-notice.test.ts`; the first Group A class
    // to land a surface is where this end-to-end half comes back.
    //
    // Inverted rather than deleted, for the reason the two cases above give:
    // the notice is emitted by the *refusing* arm of `customerFilterCond`, so
    // "there is no notice" and "this screen is still refused whole and has
    // stopped saying so" are the same absence. Asserting the row arrives is
    // what tells them apart.
    const res = await asRep('/api/v1/admin/newsletter/subscribers?page=1&pageSize=200');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ email: string }>; total: number } };
    expect(body.data.items.map((i) => i.email)).toContain(ownEmail);
    expect(noticeOf(res)).toBeUndefined();
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

  it('leaves the subscriber CSV export a CSV, and says what is now in it', async () => {
    const res = await asRep('/api/v1/admin/newsletter/subscribers/export');
    expect(res.statusCode).toBe(200);
    // The body is a string, so there is no envelope to disclose on. A download
    // that grew a JSON tail would be a corrupt file, which is worse than the
    // silence this feature exists to fix. `withScopeNotice` says so in its own
    // words — it names this export as the body it deliberately does not touch.
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.startsWith('{')).toBe(false);

    // **What that silence now means has changed, and this is where it is
    // written down** (feature 087 Group B / B4, D-187). Before the column this
    // download was a header row and nothing else, for every scoped
    // administrator, with no way to say why — the one refusal in this feature
    // that could not disclose itself. It is now the subscribers of the
    // organisations this representative is assigned to.
    expect(res.body).toContain(ownEmail);

    // And an **ownerless** subscriber is not in it. That is not a decision this
    // merge request took: R-6 — who a row with no account belongs to — is open,
    // and the column simply makes the question expressible. Recorded as an
    // assertion because it is the audience change an operator will notice, and
    // because whichever way R-6 is answered, this line is the one that has to
    // move.
    expect(res.body).not.toContain(ownerlessEmail);
  });

  it('leaves a refusal a refusal', async () => {
    // A 404 already says why. A notice about emptiness on top of it would be
    // noise, and the admin's API client reads the error envelope by shape.
    const res = await asRep('/api/v1/admin/comparisons/00000000-0000-4000-8000-0000000000ff');
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty('meta');
  });
});
