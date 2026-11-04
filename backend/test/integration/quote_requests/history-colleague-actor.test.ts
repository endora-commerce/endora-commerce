import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuoteRequestHistory } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import {
  CUSTOMER_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Feature 146, issue #283 / FR-017 / US3 #1–#2, end to end: when organization
 * administrator B answers an offer on colleague A's request, History names B
 * — the user who acted — and not A, the requester. The projection is unit
 * tested on synthetic events; this is the half that proves what the service
 * *records* when B's session is the one calling.
 */
describe('146 — History attributes a colleague\'s decision to the user who made it [integration]', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const A = { b2b_session: 'stub-customer-session' };
  const B_SESSION = `stub-146-colleague-b-${stamp}`;
  const B = { b2b_session: B_SESSION };
  const admin = { b2b_session: 'stub-admin-session' };
  let bId: string;
  const B_EMAIL = `146-colleague-b-${stamp}@h.local`;

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('146 QA: seed an organization administrator beside the stub buyer', async () => {
      const em = h.orm.em.fork();
      const b = em.create(CustomerAccount, {
        organizationId: TEST_ORGANIZATION_ID,
        email: B_EMAIL,
        passwordHash: 'x'.repeat(60),
        firstName: 'Beata',
        lastName: 'Colleague',
        // B sees A's request because B holds the *Administrator* role
        // (`specs/170-organization-roles/` R-30); the legacy `role` is dual-written.
        organizationRoleId: await predefinedRoleIdOf(em, TEST_ORGANIZATION_ID, 'administrator'),
      });
      await em.persistAndFlush(b);
      bId = b.id;
      CUSTOMER_COOKIES[B_SESSION] = { customerAccountId: b.id, organizationId: TEST_ORGANIZATION_ID };
    });
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[B_SESSION];
    await teardownBackendServer(h);
  });

  /** A raises, the rep revises; returns the id and the revision B is looking at. */
  const offered = async (): Promise<{ id: string; revision: number }> => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: A,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, desiredUnitPrice: 8 }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id, version } = (created.json() as { data: { id: string; version: number } }).data;
    const revised = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: admin,
      headers: { 'if-match': `"${version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 9 }] },
    });
    expect(revised.statusCode, revised.body).toBe(200);
    return { id, revision: (revised.json() as { data: { currentRevisionNumber: number } }).data.currentRevisionNumber };
  };

  const history = async (id: string) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}/history`, cookies: admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: QuoteRequestHistory }).data.entries;
  };

  it('B accepts A\'s offer: one acceptance entry naming B, not A', async () => {
    const { id, revision } = await offered();
    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: B,
      payload: { expectedRevisionNumber: revision },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const entries = await history(id);
    const decision = entries.filter((e) => e.kind === 'accepted_by_customer');
    expect(decision).toHaveLength(1);
    expect(decision[0]?.actor).toMatchObject({
      kind: 'customer',
      customerAccountId: bId,
      name: 'Beata Colleague',
      email: B_EMAIL,
    });
    expect(decision[0]?.actor).not.toMatchObject({ customerAccountId: TEST_CUSTOMER_ID });
    // The paired status-change record merged into the same entry.
    expect(decision[0]?.eventIds.length).toBeLessThanOrEqual(2);
  });

  it('B rejects A\'s offer with a reason: the entry names B and carries the reason', async () => {
    const { id, revision } = await offered();
    const rejected = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/reject-revision`,
      cookies: B,
      payload: { expectedRevisionNumber: revision, reason: 'Too expensive for Q4' },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const entries = await history(id);
    const decision = entries.filter((e) => e.kind === 'rejected_by_customer');
    expect(decision).toHaveLength(1);
    expect(decision[0]?.actor).toMatchObject({ kind: 'customer', customerAccountId: bId, email: B_EMAIL });
    expect(decision[0]?.reason).toBe('Too expensive for Q4');
  });
});
