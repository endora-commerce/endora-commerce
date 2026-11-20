import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import {
  makeMember,
  makeOrganization,
  orderPlacedBy,
  releaseMembers,
  submitCase,
  type ReturnsFixtureMember,
} from './organization-fixtures.js';
import {
  captureReturnsNotificationJobs,
  overrideReturnsSetting,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';

/**
 * Feature 046 (US2, FR-017) — customer is notified on authorize / reject.
 */
describe('returns — notifications', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const jobs: CapturedReturnsJob[] = [];

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({
      organizationsMailer: mailer,
      moduleOverrides: captureReturnsNotificationJobs(jobs),
    });
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  async function createCase(kind: 'return' | 'complaint' = 'return'): Promise<string> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind, lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const mailsFor = (kind: string, id: string) =>
    mailer.sent.filter((m) => m.meta?.['kind'] === kind && m.meta?.['returnCaseId'] === id);

  it('sends an authorization email with the RMA number', async () => {
    const id = await createCase();
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/authorize`, cookies: ADMIN_COOKIE });
    const rma = (res.json() as { data: { rmaNumber: string } }).data.rmaNumber;

    const mail = mailer.sent.find((m) => m.meta?.['kind'] === 'return_authorized' && m.meta?.['returnCaseId'] === id);
    expect(mail).toBeTruthy();
    expect(mail!.to).toBe('stub-customer@example.com');
    expect(mail!.text).toContain(rma);
  });

  it('sends a rejection email with the reason', async () => {
    const id = await createCase();
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'Outside policy' },
    });

    const mail = mailer.sent.find((m) => m.meta?.['kind'] === 'return_rejected' && m.meta?.['returnCaseId'] === id);
    expect(mail).toBeTruthy();
    expect(mail!.text).toContain('Outside policy');
  });

  /**
   * `specs/180-off-platform-complaints/` T022 (FR-A01, FR-A02, FR-A05, FR-A10, FR-A11,
   * FR-A44; research R-2, R-4, R-5): filing a case enqueues one `case_submitted` job
   * after the commit, and the job sends the shop e-mail and the confirmation.
   */
  describe('a new case (180 US1, US2)', () => {
    const casesJobs = (id: string) => jobs.filter((j) => j.kind === 'case_submitted' && j.returnCaseId === id);

    it.each(['return', 'complaint'] as const)('filing a %s enqueues one case_submitted job', async (kind) => {
      const id = await createCase(kind);
      expect(casesJobs(id)).toHaveLength(1);
    });

    it('a refused filing enqueues nothing', async () => {
      const before = jobs.length;
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/returns',
        cookies: CUSTOMER_COOKIE,
        payload: {
          orderId,
          kind: 'return',
          lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: '00000000-0000-4000-8000-00000000dead' }],
        },
      });
      expect(res.statusCode).toBe(422);
      expect(jobs.length).toBe(before);
    });

    it('sends one shop e-mail per valid recipient and one confirmation to the filer', async () => {
      const restore = await overrideReturnsSetting(h, 'returns.new_case_recipients', [
        ' Shop@Example.test ',
        'not-an-address',
        'b@shop.example',
        'shop@example.test',
      ]);
      try {
        const id = await createCase('complaint');
        const report = (await processReturnsNotification(h, casesJobs(id)[0]!)) as {
          messages: Array<{ code: string; status: string }>;
        };

        const shop = mailsFor('return_new_case', id);
        expect(shop.map((m) => m.to).sort()).toEqual(['b@shop.example', 'shop@example.test']);
        const reference = `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
        expect(shop[0]!.subject).toContain(reference);
        expect(report.messages).toContainEqual({ code: 'return_new_case', recipient: 'shop', status: 'invalid_recipient' });

        const confirmation = mailsFor('return_submitted', id);
        expect(confirmation).toHaveLength(1);
        expect(confirmation[0]!.to).toBe('stub-customer@example.com');
        expect(confirmation[0]!.subject).toContain(reference);
      } finally {
        await restore();
      }
    });

    it('sends no shop e-mail while no recipient is configured, and still confirms', async () => {
      const id = await createCase();
      await processReturnsNotification(h, casesJobs(id)[0]!);
      expect(mailsFor('return_new_case', id)).toHaveLength(0);
      expect(mailsFor('return_submitted', id)).toHaveLength(1);
    });

    it('confirms to the member who filed, not the colleague who placed the order (US2 s3)', async () => {
      const em = h.em();
      const org = await makeOrganization(em, '180 Filer is not placer');
      const placer: ReturnsFixtureMember = await makeMember(em, org, 'member', { label: 'Placer180' });
      const filer: ReturnsFixtureMember = await makeMember(em, org, 'administrator', { label: 'Filer180' });
      const order = await orderPlacedBy(em, placer);
      const res = await submitCase(h, filer, order);
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;

      await processReturnsNotification(h, casesJobs(id)[0]!);
      const confirmation = mailsFor('return_submitted', id);
      expect(confirmation.map((m) => m.to)).toEqual([filer.email]);
    });

    it('sends nothing for a deactivated template, and reports deactivated', async () => {
      const knex = h.em().getKnex();
      await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: false });
      try {
        const id = await createCase();
        const report = (await processReturnsNotification(h, casesJobs(id)[0]!)) as {
          messages: Array<{ code: string; status: string }>;
        };
        expect(mailsFor('return_submitted', id)).toHaveLength(0);
        expect(report.messages).toContainEqual({ code: 'return_submitted', recipient: 'customer', status: 'deactivated' });
      } finally {
        await knex('transactional_emails').where({ code: 'return_submitted' }).update({ active: true });
      }
    });
  });
});
