import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { ReturnCaseComment } from '../../helpers/package-entities.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import {
  captureReturnsNotificationJobs,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';

/**
 * Feature 046 (US4) — comment conversation with correct visibility/notify and
 * the terminal-case block.
 */
describe('returns — comments (US4)', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  const jobs: CapturedReturnsJob[] = [];

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer, moduleOverrides: captureReturnsNotificationJobs(jobs) });
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

  it('hides internal admin comments from the customer but shows visible ones', async () => {
    const id = await createCase();

    const internal = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'internal note', isCustomerVisible: false, notifyCustomer: false },
    });
    expect(internal.statusCode).toBe(201);

    const visible = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'hello customer', isCustomerVisible: true, notifyCustomer: true },
    });
    expect(visible.statusCode).toBe(201);

    // Admin sees both.
    const adminList = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/comments`, cookies: ADMIN_COOKIE });
    expect((adminList.json() as { data: unknown[] }).data).toHaveLength(2);

    // Customer detail shows only the visible one.
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/returns/${id}`, cookies: CUSTOMER_COOKIE });
    const comments = (detail.json() as { data: { comments: Array<{ body: string; isCustomerVisible: boolean }> } }).data.comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toBe('hello customer');
  });

  it('lets the customer reply and the admin see it', async () => {
    const id = await createCase();
    const reply = await h.app.inject({
      method: 'POST',
      url: `/api/v1/returns/${id}/comments`,
      cookies: CUSTOMER_COOKIE,
      payload: { body: 'a customer question' },
    });
    expect(reply.statusCode).toBe(201);
    const dto = (reply.json() as { data: { authorKind: string; isCustomerVisible: boolean } }).data;
    expect(dto.authorKind).toBe('customer');
    expect(dto.isCustomerVisible).toBe(true);

    const adminList = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/comments`, cookies: ADMIN_COOKIE });
    const bodies = (adminList.json() as { data: Array<{ body: string }> }).data.map((c) => c.body);
    expect(bodies).toContain('a customer question');
  });

  it('blocks commenting once the case is terminal', async () => {
    const id = await createCase();
    // Drive to a terminal status (rejected).
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/reject`,
      cookies: ADMIN_COOKIE,
      payload: { reason: 'not eligible' },
    });

    const adminComment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/comments`,
      cookies: ADMIN_COOKIE,
      payload: { body: 'too late', isCustomerVisible: true, notifyCustomer: false },
    });
    expect(adminComment.statusCode).toBe(409);

    const customerComment = await h.app.inject({
      method: 'POST',
      url: `/api/v1/returns/${id}/comments`,
      cookies: CUSTOMER_COOKIE,
      payload: { body: 'me too' },
    });
    expect(customerComment.statusCode).toBe(409);
  });

  /**
   * `specs/180-off-platform-complaints/` T023 (FR-A20 – FR-A22, research R-6): a
   * customer-visible comment with *notify customer* e-mails the filer; nothing else
   * does, and nothing stored before the feature ever will.
   */
  describe('notify customer (180 US3)', () => {
    const post = (id: string, payload: Record<string, unknown>) =>
      h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${id}/comments`, cookies: ADMIN_COOKIE, payload });
    const commentJobs = (commentId: string) =>
      jobs.filter((j) => j.kind === 'comment_notify' && j.returnCaseCommentId === commentId);

    it('enqueues one comment_notify for a customer-visible comment with notify, which e-mails the body', async () => {
      const id = await createCase();
      const res = await post(id, { body: 'Your parcel arrived today.', isCustomerVisible: true, notifyCustomer: true });
      expect(res.statusCode).toBe(201);
      const commentId = (res.json() as { data: { id: string } }).data.id;
      expect(commentJobs(commentId)).toHaveLength(1);

      await processReturnsNotification(h, commentJobs(commentId)[0]!);
      const mails = mailer.sent.filter((m) => m.meta?.['kind'] === 'return_comment_added' && m.meta?.['returnCaseId'] === id);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.to).toBe('stub-customer@example.com');
      expect(mails[0]!.text).toContain('Your parcel arrived today.');
    });

    it('enqueues nothing for a comment without notify', async () => {
      const id = await createCase();
      const res = await post(id, { body: 'Just so you know.', isCustomerVisible: true, notifyCustomer: false });
      expect(res.statusCode).toBe(201);
      expect(commentJobs((res.json() as { data: { id: string } }).data.id)).toHaveLength(0);
    });

    it('refuses notify on an internal comment with 422, storing and enqueuing nothing', async () => {
      const id = await createCase();
      const before = jobs.length;
      const res = await post(id, { body: 'internal', isCustomerVisible: false, notifyCustomer: true });
      expect(res.statusCode).toBe(422);
      expect(jobs.length).toBe(before);
      const stored = await h.em().fork().count(ReturnCaseComment, { returnCaseId: id });
      expect(stored).toBe(0);
    });

    it('never sends a comment stored before the feature, notify flag or not', async () => {
      const id = await createCase();
      const em = h.em().fork();
      const legacy = em.create(ReturnCaseComment, {
        returnCaseId: id,
        authorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
        body: 'stored before the release',
        isCustomerVisible: true,
        notifyCustomer: true,
      } as never);
      await em.persist(legacy).flush();
      // A later comment on the same case enqueues its own job and nothing for the old one.
      await post(id, { body: 'A new message.', isCustomerVisible: true, notifyCustomer: true });
      expect(commentJobs((legacy as unknown as { id: string }).id)).toHaveLength(0);
    });
  });
});
