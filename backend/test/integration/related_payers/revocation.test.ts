import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RelatedPayerWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { makeMember, releaseMembers, type ReturnsFixtureMember } from '../returns/organization-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, customerNotificationsOf, drainOutbox, placePaidOrder } from './fixtures.js';

/**
 * `specs/182-related-payers/` T075 (US7; FR-050, FR-051) — a link is revoked from X (*Manage
 * payers*), from Y (*Approve payer requests*), by the operator or through the port. Each time the
 * link is `revoked` with who did it, the other side is told by e-mail and in the account, the
 * next checkout no longer offers Y and a placement naming Y is refused — while the order placed
 * before stays billed to Y and visible to Y.
 */
describe('related_payers — revocation (US7)', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const STUB = { b2b_session: 'stub-customer-session' };
  let buyerEmail: string;

  const call = (cookies: Record<string, string>, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const revokedMails = (linkId: string) =>
    mailer.sent.filter((m) => m.meta?.['linkId'] === linkId && m.meta?.['kind'] === 'related_payer_link_revoked').map((m) => m.to);

  /** A paid order of the stub buyer X to a fresh Y, and Y's approver who may also read paid orders. */
  async function paidOrderWithApprover() {
    const paid = await placePaidOrder(h);
    const approver = await makeMember(
      h.em(),
      paid.payerId,
      { permissions: ['related_payers.approve', 'related_payers.view_paid_orders'] },
      { label: 'RP-Approver' },
    );
    // The role was seeded behind the organization-role cache, which a real role write drops.
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } }).organizationRoleCache.invalidateLocal(
      paid.payerId,
    );
    return { ...paid, approver };
  }

  async function linkState(linkId: string) {
    const res = await call(ADMIN, 'GET', `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`);
    return (res.json().data.asBuyer as Array<{ id: string; state: string; revokedByKind: string | null; revokedAt: string | null }>).find(
      (l) => l.id === linkId,
    );
  }

  /** FR-051 and the refusal: Y keeps the earlier order; X can no longer name Y. */
  async function expectRevokedEffects(paid: Awaited<ReturnType<typeof paidOrderWithApprover>>) {
    const payers = (await call(STUB, 'GET', '/api/v1/checkout/payers')).json().data as Array<{ organizationId: string }>;
    expect(payers.map((p) => p.organizationId)).not.toContain(paid.payerId);
    const { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID, seedCartForStubCustomer } = await import('../../helpers/seed-commerce.js');
    await seedCartForStubCustomer(h.em());
    const preview = await call(STUB, 'POST', '/api/v1/orders/preview-total', {
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      billingAddressId: paid.billingAddressId,
      payerOrganizationId: paid.payerId,
    });
    expect(preview.statusCode, preview.body).toBe(422);
    expect(preview.json().error.code).toBe('RELATED_PAYER_NOT_USABLE');
    const paidOrders = await call({ b2b_session: paid.approver.cookie }, 'GET', `/api/v1/account/paid-orders/${paid.orderId}`);
    expect(paidOrders.statusCode, paidOrders.body).toBe(200);
    expect(paidOrders.json().data).toMatchObject({ payer: { organizationId: paid.payerId } });
  }

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const [row] = (await withSystemScope('test read: stub buyer e-mail', () =>
      h.em().getConnection().execute('select email from customer_accounts where id = ?', [TEST_CUSTOMER_ID]),
    )) as Array<{ email: string }>;
    buyerEmail = row!.email;
  }, 120_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  it('US7-1: Y revokes — revoked by the payer, X\'s payer managers told, X can no longer name Y', async () => {
    const paid = await paidOrderWithApprover();
    const res = await call({ b2b_session: paid.approver.cookie }, 'POST', `/api/v1/account/payees/${paid.linkId}/revoke`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await linkState(paid.linkId)).toMatchObject({ state: 'revoked', revokedByKind: 'payer', revokedAt: expect.any(String) });
    await expectRevokedEffects(paid);

    await drainOutbox(h);
    expect(revokedMails(paid.linkId)).toContain(buyerEmail);
    expect(revokedMails(paid.linkId)).not.toContain(paid.approver.email);
    expect((await customerNotificationsOf(h.em(), TEST_CUSTOMER_ID)).filter((n) => n.subject_id === paid.linkId)).toEqual([
      expect.objectContaining({ kind: 'related_payers.link_revoked' }),
    ]);
  });

  it('X revokes — revoked by the buyer, Y\'s approvers told', async () => {
    const paid = await paidOrderWithApprover();
    const res = await call(STUB, 'POST', `/api/v1/account/related-payers/${paid.linkId}/revoke`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await linkState(paid.linkId)).toMatchObject({ state: 'revoked', revokedByKind: 'buyer' });
    await expectRevokedEffects(paid);

    await drainOutbox(h);
    expect(revokedMails(paid.linkId)).toEqual([paid.approver.email]);
    expect((await customerNotificationsOf(h.em(), paid.approver.id)).map((n) => n.subject_id)).toContain(paid.linkId);
  });

  it('the operator revokes — both sides told', async () => {
    const paid = await paidOrderWithApprover();
    const res = await call(ADMIN, 'POST', `/api/v1/admin/related-payers/links/${paid.linkId}/revoke`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await linkState(paid.linkId)).toMatchObject({ state: 'revoked', revokedByKind: 'operator' });
    await expectRevokedEffects(paid);

    await drainOutbox(h);
    expect(revokedMails(paid.linkId)).toEqual(expect.arrayContaining([buyerEmail, paid.approver.email]));
  });

  it('the port revokes — both sides told', async () => {
    const paid = await paidOrderWithApprover();
    const port = h.container.resolve<RelatedPayerWritePort>('relatedPayerWritePort');
    expect(
      await port.revokePayer({ buyerOrganizationId: TEST_ORGANIZATION_ID, payerOrganizationId: paid.payerId, source: 'erp.revoke' }),
    ).toEqual({ revoked: true });
    expect(await linkState(paid.linkId)).toMatchObject({ state: 'revoked', revokedByKind: 'automation' });
    await expectRevokedEffects(paid);

    await drainOutbox(h);
    expect(revokedMails(paid.linkId)).toEqual(expect.arrayContaining([buyerEmail, paid.approver.email]));
  });

  it('a revoked link cannot be revoked again from either side', async () => {
    const paid: { linkId: string; approver: ReturnsFixtureMember } = await paidOrderWithApprover();
    expect((await call(STUB, 'POST', `/api/v1/account/related-payers/${paid.linkId}/revoke`)).statusCode).toBe(200);
    expect((await call(STUB, 'POST', `/api/v1/account/related-payers/${paid.linkId}/revoke`)).statusCode).toBe(409);
    expect((await call({ b2b_session: paid.approver.cookie }, 'POST', `/api/v1/account/payees/${paid.linkId}/revoke`)).statusCode).toBe(409);
  });
});
