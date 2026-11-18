import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ReturnCase } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * Feature 046 (US2) — admin authorizes (RMA number) or rejects (reason).
 */
describe('returns — authorize / reject (US2)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createCase(): Promise<string> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('assigns a unique RMA number on authorization and advances the status', async () => {
    const a = await createCase();
    const b = await createCase();

    const ra = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${a}/authorize`, cookies: ADMIN_COOKIE });
    const rb = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${b}/authorize`, cookies: ADMIN_COOKIE });
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    const da = (ra.json() as { data: { rmaNumber: string; statusCode: string } }).data;
    const db = (rb.json() as { data: { rmaNumber: string; statusCode: string } }).data;
    expect(da.statusCode).toBe('authorized');
    expect(da.rmaNumber).toBeTruthy();
    expect(db.rmaNumber).toBeTruthy();
    expect(da.rmaNumber).not.toBe(db.rmaNumber);
  });

  it('rejects a case with a mandatory reason and reaches the rejected terminal', async () => {
    const id = await createCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'Outside warranty window' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { statusCode: string; rejectionReason: string } }).data;
    expect(data.statusCode).toBe('rejected');
    expect(data.rejectionReason).toBe('Outside warranty window');
  });

  it('refuses rejection without a reason', async () => {
    const id = await createCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: '' },
    });
    expect([400, 422]).toContain(res.statusCode);
  });

  /**
   * `specs/180-off-platform-complaints/` T011 (FR-A40, research R-7.3, F3): entering
   * `authorized` or `rejected` has its dedicated effects on **every** admin path —
   * the generic and the bulk transition included, which used to skip them.
   */
  describe('the dedicated effects on every path (180 FR-A40)', () => {
    async function stored(id: string): Promise<{
      rmaNumber: string | null;
      authorizedAt: Date | null;
      authorizedByAdminUserId: string | null;
    }> {
      const rc = await h.em().fork().findOneOrFail(ReturnCase, { id });
      return {
        rmaNumber: rc.rmaNumber ?? null,
        authorizedAt: rc.authorizedAt ?? null,
        authorizedByAdminUserId: rc.authorizedByAdminUserId ?? null,
      };
    }

    function mails(kind: string, id: string): number {
      return mailer.sent.filter((m) => m.meta?.['kind'] === kind && m.meta?.['returnCaseId'] === id).length;
    }

    async function expectAuthorized(id: string): Promise<void> {
      const rc = await stored(id);
      expect(rc.rmaNumber).toBeTruthy();
      expect(rc.authorizedAt).toBeInstanceOf(Date);
      expect(rc.authorizedByAdminUserId).toBe(TEST_ADMIN_ID);
      expect(mails('return_authorized', id)).toBe(1);
    }

    it('POST /authorize stamps the RMA number, the time and the authorizer, and sends one e-mail', async () => {
      const id = await createCase();
      const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
      expect(res.statusCode).toBe(200);
      await expectAuthorized(id);
    });

    it('POST /transition into authorized has the same effects', async () => {
      const id = await createCase();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${id}/transition`,
        cookies: ADMIN_COOKIE,
        payload: { to: 'authorized' },
      });
      expect(res.statusCode).toBe(200);
      await expectAuthorized(id);
      const detail = (res.json() as { data: { rmaNumber: string | null; authorizedAt: string | null } }).data;
      expect(detail.rmaNumber).toBeTruthy();
      expect(detail.authorizedAt).toBeTruthy();
    });

    it('POST /bulk-transition into authorized has the same effects on every moved case', async () => {
      const a = await createCase();
      const b = await createCase();
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/returns/bulk-transition',
        cookies: ADMIN_COOKIE,
        payload: { ids: [a, b], to: 'authorized' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { moved: string[] } }).data.moved).toEqual([a, b]);
      await expectAuthorized(a);
      await expectAuthorized(b);
      expect((await stored(a)).rmaNumber).not.toBe((await stored(b)).rmaNumber);
    });

    it('POST /transition and /bulk-transition into rejected each send one rejection e-mail', async () => {
      const single = await createCase();
      const bulk = await createCase();
      const one = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${single}/transition`,
        cookies: ADMIN_COOKIE,
        payload: { to: 'rejected', reason: 'Outside policy' },
      });
      expect(one.statusCode).toBe(200);
      const many = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/returns/bulk-transition',
        cookies: ADMIN_COOKIE,
        payload: { ids: [bulk], to: 'rejected' },
      });
      expect(many.statusCode).toBe(200);
      expect(mails('return_rejected', single)).toBe(1);
      expect(mails('return_rejected', bulk)).toBe(1);
      // A rejection authorizes nothing.
      expect((await stored(single)).authorizedByAdminUserId).toBeNull();
      expect(mails('return_authorized', single)).toBe(0);
    });
  });
});
