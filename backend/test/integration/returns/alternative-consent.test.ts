import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES, TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminRole, AdminUser, Order, Organization, Refund, ReturnCase } from '../../helpers/package-entities.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { ADMIN_COOKIE, resetReturnGraph } from './helpers.js';
import {
  fileCase,
  makeMember,
  makeOrganization,
  orderPlacedBy,
  releaseMembers,
  submitCase,
  type ReturnsFixtureMember,
} from './organization-fixtures.js';

/**
 * Issue #905, PR 2 (design §2 and D1) — a consumer withdrawal settles as a
 * refund by default; a credit, a replacement or a repair needs the consumer's
 * consent on record, which an operator records with an evidence note through
 * an audited Command and may revoke until the case is settled.
 */
describe('returns — consumer withdrawal: classification and recorded consent (#905)', () => {
  let h: BackendServerHandle;
  let consumer: ReturnsFixtureMember;
  let business: ReturnsFixtureMember;
  const READER_COOKIE = `stub-905-returns-reader-${randomUUID()}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    const em = h.em();

    // A personal (B2C) Organization, as checkout gives every consumer one.
    const personalId = randomUUID();
    const personal = em.create(Organization, {
      id: personalId,
      name: `905 Consumer ${personalId.slice(0, 8)}`,
      taxId: personalId.replace(/-/g, ''),
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: true,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    } as never);
    await em.persistAndFlush(personal);
    await bindOrganizationsToFixtureChannelsSql(em, [personalId]);
    (personal as { path: string }).path = `/${personalId}/`;
    await em.flush();
    consumer = await makeMember(em, personalId, 'administrator', { label: 'Consumer905' });
    business = await makeMember(em, await makeOrganization(em, '905 Company'), 'administrator', { label: 'Company905' });

    // An operator who may read returns and nothing more.
    const role = em.create(AdminRole, {
      id: randomUUID(),
      code: `returns_reader_905_${randomUUID().slice(0, 8)}`,
      name: 'Returns reader (#905)',
      permissions: ['returns:read'],
    } as never);
    await em.persistAndFlush(role);
    const reader = em.create(AdminUser, {
      id: randomUUID(),
      email: `returns-reader-905-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'x',
      firstName: 'Returns',
      lastName: 'Reader',
      adminRoleId: (role as { id: string }).id,
      status: 'active',
    } as never);
    await em.persistAndFlush(reader);
    ADMIN_COOKIES[READER_COOKIE] = { adminUserId: (reader as { id: string }).id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[READER_COOKIE];
    releaseMembers();
    await teardownBackendServer(h);
  });

  const admin = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, cookies = ADMIN_COOKIE) =>
    h.app.inject({ method, url, cookies, ...(payload ? { payload } : {}) });

  async function caseOf(member: ReturnsFixtureMember, kind: 'return' | 'complaint' = 'return') {
    const order = await orderPlacedBy(h.em(), member);
    const res = await submitCase(h, member, order, { kind });
    expect(res.statusCode, res.body).toBe(201);
    return { id: (res.json() as { data: { id: string } }).data.id, orderId: order.orderId };
  }

  async function received(id: string): Promise<void> {
    expect((await admin('POST', `/api/v1/admin/returns/${id}/authorize`)).statusCode).toBe(200);
    expect((await admin('POST', `/api/v1/admin/returns/${id}/transition`, { to: 'received' })).statusCode).toBe(200);
  }

  async function detail(id: string) {
    const res = await admin('GET', `/api/v1/admin/returns/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Record<string, unknown> & { items: Array<{ id: string }> } }).data;
  }

  async function prefill(id: string) {
    const res = await admin('GET', `/api/v1/admin/returns/${id}/settlement`);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Record<string, unknown> }).data;
  }

  async function settle(id: string, resolutionType: string, extra: Record<string, unknown> = {}) {
    const rc = await detail(id);
    return admin('POST', `/api/v1/admin/returns/${id}/settlement`, {
      resolutionType,
      lines: [{ returnCaseItemId: rc.items[0]!.id, approvedRefundAmount: 10 }],
      createCorrectiveInvoice: false,
      ...extra,
    });
  }

  const recordConsent = (id: string, body: Record<string, unknown> = {}) =>
    admin('POST', `/api/v1/admin/returns/${id}/alternative-consent`, {
      resolution: 'credit',
      consentGivenAt: new Date().toISOString(),
      note: "Customer's e-mail of today, ticket #905",
      ...body,
    });

  const auditOf = (id: string, action: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'return_case', objectId: id, action }, { orderBy: { actedAt: 'asc' } });

  describe('classification at filing (design §2)', () => {
    it('classifies a return by a personal organization, in the period, as a consumer withdrawal', async () => {
      const { id } = await caseOf(consumer);
      expect((await detail(id)).consumerWithdrawal).toBe(true);
      const row = await h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
      // The trader received the statement when the case was filed (design D2).
      expect((row as unknown as { withdrawalReceivedAt: Date | null }).withdrawalReceivedAt?.toISOString()).toBe(
        row.submittedAt.toISOString(),
      );
    });

    it('never classifies a complaint, or a company organization’s return', async () => {
      expect((await detail((await caseOf(consumer, 'complaint')).id)).consumerWithdrawal).toBe(false);
      expect((await detail((await caseOf(business)).id)).consumerWithdrawal).toBe(false);
    });

    it('classifies a personal organization’s return filed after the function closed as a commercial return', async () => {
      const order = await orderPlacedBy(h.em(), consumer);
      await h.em().getConnection().execute(`update "orders" set "completed_at" = now() - interval '60 days' where "id" = ?`, [
        order.orderId,
      ]);
      const id = await fileCase(h, consumer, order);
      expect((await detail(id)).consumerWithdrawal).toBe(false);
    });
  });

  describe('settlement (design D1)', () => {
    it('proposes a refund to the order’s own payment method, and names what needs consent', async () => {
      const { id, orderId } = await caseOf(consumer);
      await received(id);
      const order = await h.em().fork().findOneOrFail(Order, { id: orderId }, { filters: false });
      expect(await prefill(id)).toMatchObject({
        defaultResolution: 'refund',
        consentRequiredFor: ['credit', 'replacement', 'repair'],
        defaultRefundPaymentMethodId: order.paymentMethodId,
        resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
      });
    });

    it('refuses a credit, a replacement and a repair without consent, and writes nothing', async () => {
      const { id } = await caseOf(consumer);
      await received(id);
      for (const resolution of ['credit', 'replacement', 'repair']) {
        const res = await settle(id, resolution);
        expect(res.statusCode, res.body).toBe(422);
        const error = (res.json() as { error: { code: string; details: { resolution: string } } }).error;
        expect(error.code).toBe('RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED');
        expect(error.details.resolution).toBe(resolution);
      }
      const row = await h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
      expect(row.statusCode).toBe('received');
      expect(await h.em().fork().count(Refund, { returnCaseId: id })).toBe(0);
    });

    it('settles as the consented resolution, and refuses any other', async () => {
      const { id } = await caseOf(consumer);
      await received(id);
      const recorded = await recordConsent(id, { resolution: 'credit' });
      expect(recorded.statusCode, recorded.body).toBe(200);
      expect((recorded.json() as { data: { alternativeResolutionConsent: unknown } }).data.alternativeResolutionConsent).toMatchObject({
        resolution: 'credit',
        note: "Customer's e-mail of today, ticket #905",
        byAdminUserId: TEST_ADMIN_ID,
        source: 'operator_recorded',
      });
      expect((await prefill(id)).consentRequiredFor).toEqual(['replacement', 'repair']);

      const replacement = await settle(id, 'replacement');
      expect(replacement.statusCode, replacement.body).toBe(422);
      expect((replacement.json() as { error: { code: string } }).error.code).toBe(
        'RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED',
      );

      const credit = await settle(id, 'credit');
      expect(credit.statusCode, credit.body).toBe(200);
    });

    it('refuses again once the consent is revoked', async () => {
      const { id } = await caseOf(consumer);
      await received(id);
      expect((await recordConsent(id)).statusCode).toBe(200);
      const revoked = await admin('DELETE', `/api/v1/admin/returns/${id}/alternative-consent`);
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect((revoked.json() as { data: { alternativeResolutionConsent: unknown } }).data.alternativeResolutionConsent).toBeNull();
      expect((await settle(id, 'credit')).statusCode).toBe(422);
    });

    it('leaves a company organization’s return and a complaint free to settle as credit', async () => {
      for (const { id } of [await caseOf(business), await caseOf(consumer, 'complaint')]) {
        await received(id);
        expect((await prefill(id)).consentRequiredFor).toEqual([]);
        const res = await settle(id, 'credit');
        expect(res.statusCode, res.body).toBe(200);
      }
    });

    it('accepts a refund to another method than the order’s, and flags it in the audit row', async () => {
      const own = await caseOf(consumer);
      await received(own.id);
      const order = await h.em().fork().findOneOrFail(Order, { id: own.orderId }, { filters: false });
      expect((await settle(own.id, 'refund', { refundPaymentMethodId: order.paymentMethodId })).statusCode).toBe(200);

      const other = await caseOf(consumer);
      await received(other.id);
      const res = await settle(other.id, 'refund', { refundPaymentMethodId: randomUUID() });
      expect(res.statusCode, res.body).toBe(200);

      const [ownRow] = await auditOf(own.id, 'return.settled');
      const [otherRow] = await auditOf(other.id, 'return.settled');
      expect(ownRow?.stateAfter).toMatchObject({ consumerWithdrawal: true, refundMethodDiffers: false });
      expect(otherRow?.stateAfter).toMatchObject({ consumerWithdrawal: true, refundMethodDiffers: true });
    });
  });

  describe('the consent Commands (Principle XIII)', () => {
    it('audits recording and revoking, with the operator as the actor and no evidence text', async () => {
      const { id } = await caseOf(consumer);
      const consentGivenAt = new Date().toISOString();
      expect((await recordConsent(id, { resolution: 'repair', consentGivenAt })).statusCode).toBe(200);
      expect((await admin('DELETE', `/api/v1/admin/returns/${id}/alternative-consent`)).statusCode).toBe(200);

      const [record] = await auditOf(id, 'return_case.alternative_consent.record');
      expect(record?.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(record?.stateBefore).toEqual({ resolution: null, at: null, source: null });
      expect(record?.stateAfter).toEqual({ resolution: 'repair', at: consentGivenAt, source: 'operator_recorded' });
      expect(JSON.stringify(record)).not.toContain('ticket #905');

      const [revoke] = await auditOf(id, 'return_case.alternative_consent.revoke');
      expect(revoke?.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(revoke?.stateBefore).toEqual({ resolution: 'repair', at: consentGivenAt, source: 'operator_recorded' });
      expect(revoke?.stateAfter).toEqual({ resolution: null, at: null, source: null });
    });

    it('writes no audit row for revoking a consent that is not there', async () => {
      const { id } = await caseOf(consumer);
      const res = await admin('DELETE', `/api/v1/admin/returns/${id}/alternative-consent`);
      expect(res.statusCode, res.body).toBe(200);
      expect(await auditOf(id, 'return_case.alternative_consent.revoke')).toHaveLength(0);
    });

    it('refuses a consent dated in the future or before the case was filed', async () => {
      const { id } = await caseOf(consumer);
      const future = await recordConsent(id, { consentGivenAt: new Date(Date.now() + 3_600_000).toISOString() });
      expect(future.statusCode, future.body).toBe(422);
      expect((future.json() as { error: { details: { code: string } } }).error.details.code).toBe('consent_in_future');
      const early = await recordConsent(id, { consentGivenAt: '2020-01-01T00:00:00.000Z' });
      expect(early.statusCode, early.body).toBe(422);
      expect((early.json() as { error: { details: { code: string } } }).error.details.code).toBe('consent_before_submission');
      expect(await auditOf(id, 'return_case.alternative_consent.record')).toHaveLength(0);
    });

    it('refuses a consent on a case that is not a consumer withdrawal', async () => {
      const { id } = await caseOf(business);
      const res = await recordConsent(id);
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as { error: { details: { code: string } } }).error.details.code).toBe('not_consumer_withdrawal');
    });

    it('freezes the consent once the case is settled', async () => {
      const { id } = await caseOf(consumer);
      await received(id);
      expect((await recordConsent(id)).statusCode).toBe(200);
      expect((await settle(id, 'credit')).statusCode).toBe(200);
      for (const res of [await recordConsent(id, { resolution: 'repair' }), await admin('DELETE', `/api/v1/admin/returns/${id}/alternative-consent`)]) {
        expect(res.statusCode, res.body).toBe(409);
        expect((res.json() as { error: { details: { code: string } } }).error.details.code).toBe('consent_frozen');
      }
      expect((await detail(id)).alternativeResolutionConsent).toMatchObject({ resolution: 'credit' });
    });

    it('needs returns:write: an operator who may only read is refused', async () => {
      const { id } = await caseOf(consumer);
      const cookies = { b2b_admin_session: READER_COOKIE };
      expect((await admin('GET', `/api/v1/admin/returns/${id}`, undefined, cookies)).statusCode).toBe(200);
      expect((await recordConsent(id, {})).statusCode).toBe(200);
      for (const method of ['POST', 'DELETE'] as const) {
        const res = await admin(
          method,
          `/api/v1/admin/returns/${id}/alternative-consent`,
          method === 'POST' ? { resolution: 'credit', consentGivenAt: new Date().toISOString(), note: 'x' } : undefined,
          cookies,
        );
        expect(res.statusCode, res.body).toBe(403);
      }
      expect((await detail(id)).alternativeResolutionConsent).toMatchObject({ resolution: 'credit' });
    });

    it('refuses an unknown case with 404', async () => {
      expect((await recordConsent(randomUUID())).statusCode).toBe(404);
      expect((await admin('DELETE', `/api/v1/admin/returns/${randomUUID()}/alternative-consent`)).statusCode).toBe(404);
    });
  });
});
