import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpportunityCommentListResponseSchema, OpportunityCommentResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AdminNotification, CrmOpportunityComment } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmOrder,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';

/**
 * Notes and internal messages on an Opportunity (User Story 4;
 * `specs/143-crm-sales-opportunities/research.md` R-10, R-11).
 *
 * Two kinds, one table, two behaviours: **a note is its author's** — only they
 * edit or delete it; **a message is nobody's to change** once sent, and it
 * tells the people in the conversation. Both are internal: there is no
 * customer-visible flag, and no customer-facing route reads either.
 */
describe('crm notes and messages', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let colleague: Seeded;
  let third: Seeded;
  let rep: Seeded;
  let organizationB: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    cookies: Record<string, string> = CRM_ADMIN,
  ) =>
    h.app.inject({
      method,
      url: `${CRM_API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const add = async (
    opportunityId: string,
    kind: 'note' | 'message',
    body: string,
    cookies?: Record<string, string>,
  ) => {
    const response = await call('POST', `/opportunities/${opportunityId}/comments`, { kind, body }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityCommentResponseSchema.parse(response.json()).data;
  };

  const list = async (opportunityId: string, kind: 'note' | 'message', cookies?: Record<string, string>) =>
    OpportunityCommentListResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunityId}/comments?kind=${kind}`, undefined, cookies)).json(),
    ).data;

  const messageNotifications = async (opportunityId: string) =>
    (
      await h.em().find(
        AdminNotification,
        { subjectId: opportunityId, kind: 'crm.opportunity.message' },
        { filters: false, orderBy: { createdAt: 'asc' } },
      )
    ).map((row) => row.targetAdminUserId ?? null);

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    colleague = await seedCrmAdmin(h.em(), 'comment-colleague', ['crm:read', 'crm:write', 'orders:read']);
    third = await seedCrmAdmin(h.em(), 'comment-third', ['crm:read', 'crm:write', 'orders:read']);
    organizationB = await seedCrmOrganization(h.em(), 'Comments B');
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write', 'orders:read']);
  });

  afterAll(async () => {
    for (const admin of [colleague, third, rep]) admin.undo();
    await teardownBackendServer(h);
  });

  describe('a note', () => {
    it('is listed with its author, and edited only by its author', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const note = await add(opportunity.id, 'note', 'Budget confirmed for Q3.', colleague.cookies);
      expect(note.author.id).toBe(colleague.adminUserId);

      const listed = await list(opportunity.id, 'note');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: note.id, body: 'Budget confirmed for Q3.', editedAt: null });
      expect(listed[0]?.author).toEqual(note.author);

      // Somebody else — even the platform administrator — may not edit or delete it.
      const path = `/opportunities/${opportunity.id}/comments/${note.id}`;
      for (const response of [await call('PATCH', path, { body: 'Hijacked' }), await call('DELETE', path)]) {
        expect(response.statusCode, response.body).toBe(403);
        expect(response.json().error.code).toBe('FORBIDDEN');
      }
      expect((await list(opportunity.id, 'note'))[0]?.body).toBe('Budget confirmed for Q3.');

      const edited = await call('PATCH', path, { body: 'Budget confirmed for Q4.' }, colleague.cookies);
      expect(edited.statusCode, edited.body).toBe(200);
      const after = (await list(opportunity.id, 'note'))[0];
      expect(after?.body).toBe('Budget confirmed for Q4.');
      expect(after?.editedAt).toEqual(expect.any(String));

      const audit = await h.auditLogService.query({ action: 'crm.opportunity.note_update', objectId: opportunity.id });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        objectType: 'crm_opportunity',
        stateBefore: { commentId: note.id, body: 'Budget confirmed for Q3.' },
        stateAfter: { commentId: note.id, body: 'Budget confirmed for Q4.' },
      });
    });

    it('disappears from the list when its author deletes it, and stays in the audit trail', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const kept = await add(opportunity.id, 'note', 'Kept.');
      const gone = await add(opportunity.id, 'note', 'Written in haste.');

      const response = await call('DELETE', `/opportunities/${opportunity.id}/comments/${gone.id}`);
      expect(response.statusCode, response.body).toBe(204);
      expect((await list(opportunity.id, 'note')).map((note) => note.id)).toEqual([kept.id]);

      const added = await h.auditLogService.query({ action: 'crm.opportunity.note_add', objectId: opportunity.id });
      const deleted = await h.auditLogService.query({ action: 'crm.opportunity.note_delete', objectId: opportunity.id });
      expect(added).toHaveLength(2);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ stateBefore: { commentId: gone.id, body: 'Written in haste.' } });
      // The row is kept, marked: the history stays truthful about what was written.
      const row = await h.em().findOneOrFail(CrmOpportunityComment, { id: gone.id }, { filters: false });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(row.body).toBe('Written in haste.');
      // A deleted note cannot be edited back to life.
      const revived = await call('PATCH', `/opportunities/${opportunity.id}/comments/${gone.id}`, { body: 'Back' });
      expect(revived.statusCode, revived.body).toBe(404);
    });

    it('notifies nobody', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      expect((await call('POST', `/opportunities/${opportunity.id}/assign`, { adminUserId: colleague.adminUserId })).statusCode).toBe(200);
      await add(opportunity.id, 'note', 'For my own eyes.');
      expect(await messageNotifications(opportunity.id)).toEqual([]);
    });
  });

  describe('a message', () => {
    it('cannot be edited or deleted, by its author or by anybody — 409 CRM_MESSAGE_IMMUTABLE', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const message = await add(opportunity.id, 'message', 'Sent as written.', colleague.cookies);
      const path = `/opportunities/${opportunity.id}/comments/${message.id}`;
      for (const cookies of [colleague.cookies, CRM_ADMIN]) {
        for (const response of [await call('PATCH', path, { body: 'Reworded' }, cookies), await call('DELETE', path, undefined, cookies)]) {
          expect(response.statusCode, response.body).toBe(409);
          expect(response.json().error.code).toBe('CRM_MESSAGE_IMMUTABLE');
        }
      }
      expect((await list(opportunity.id, 'message')).map((m) => m.body)).toEqual(['Sent as written.']);
      const audit = await h.auditLogService.query({ action: 'crm.opportunity.message_add', objectId: opportunity.id });
      expect(audit).toHaveLength(1);
    });

    it('notifies the assignee and everybody who already wrote in the thread — never the author', async () => {
      const opportunity = await createCrmOpportunity(h, { title: 'Conveyor line', assignedAdminUserId: null });
      expect((await call('POST', `/opportunities/${opportunity.id}/assign`, { adminUserId: colleague.adminUserId })).statusCode).toBe(200);

      // 1. The platform administrator writes: the assignee is told.
      await add(opportunity.id, 'message', 'Any news from the customer?');
      expect(await messageNotifications(opportunity.id)).toEqual([colleague.adminUserId]);

      // 2. The assignee answers: the earlier participant is told, the author is not.
      await add(opportunity.id, 'message', 'They asked for a week.', colleague.cookies);
      expect(await messageNotifications(opportunity.id)).toEqual([colleague.adminUserId, TEST_ADMIN_ID]);

      // 3. A third person joins: the assignee and the first participant, each once.
      await add(opportunity.id, 'message', 'I can cover while you are away.', third.cookies);
      const all = await messageNotifications(opportunity.id);
      expect(all.slice(2).sort()).toEqual([TEST_ADMIN_ID, colleague.adminUserId].sort());
      expect(all).not.toContain(third.adminUserId);

      const sample = await h.em().findOneOrFail(
        AdminNotification,
        { subjectId: opportunity.id, kind: 'crm.opportunity.message' },
        { filters: false },
      );
      expect(sample).toMatchObject({
        audience: 'admin_user',
        subjectType: 'crm_opportunity',
        linkPath: `/crm/opportunities/${opportunity.id}`,
      });
      expect(sample.title).toContain(opportunity.number);
    });

    it('is still stored, and tells nobody, while admin_notifications is deactivated', async () => {
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      expect((await call('POST', `/opportunities/${opportunity.id}/assign`, { adminUserId: colleague.adminUserId })).statusCode).toBe(200);
      const before = await h.em().count(AdminNotification, { subjectId: opportunity.id }, { filters: false });

      await withModuleOff('admin_notifications', 'deactivated', async () => {
        const response = await call('POST', `/opportunities/${opportunity.id}/comments`, {
          kind: 'message',
          body: 'Sent while the bell is off.',
        });
        expect(response.statusCode, response.body).toBe(201);
      });

      expect((await list(opportunity.id, 'message')).map((m) => m.body)).toEqual(['Sent while the bell is off.']);
      expect(await h.em().count(AdminNotification, { subjectId: opportunity.id }, { filters: false })).toBe(before);
      // Positive control after restoration.
      await add(opportunity.id, 'message', 'Sent with the bell on.');
      expect(await messageNotifications(opportunity.id)).toEqual([colleague.adminUserId]);
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for the comments of an Opportunity out of reach — read, add, edit, delete', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB, assignedAdminUserId: null });
      const note = await add(foreign.id, 'note', 'Not for the rep.');
      const base = `/opportunities/${foreign.id}/comments`;

      const probes = [
        await call('GET', `${base}?kind=note`, undefined, rep.cookies),
        await call('POST', base, { kind: 'note', body: 'Intrusion' }, rep.cookies),
        await call('PATCH', `${base}/${note.id}`, { body: 'Intrusion' }, rep.cookies),
        await call('DELETE', `${base}/${note.id}`, undefined, rep.cookies),
      ];
      for (const response of probes) {
        expect(response.statusCode, response.body).toBe(404);
        expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      }
      expect((await list(foreign.id, 'note')).map((n) => n.body)).toEqual(['Not for the rep.']);
    });

    it('answers 404 for a comment of another Opportunity addressed under one the caller reaches', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB, assignedAdminUserId: null });
      const own = await createCrmOpportunity(h, { assignedAdminUserId: null });
      // Written by the rep's own hand elsewhere is not the point: the note is B's.
      const foreignNote = await add(foreign.id, 'note', 'B keeps this.');
      const path = `/opportunities/${own.id}/comments/${foreignNote.id}`;

      for (const response of [
        await call('PATCH', path, { body: 'Reached across' }, rep.cookies),
        await call('DELETE', path, undefined, rep.cookies),
        // …and the same for an administrator who reaches both: the address is wrong.
        await call('PATCH', path, { body: 'Reached across' }),
      ]) {
        expect(response.statusCode, response.body).toBe(404);
        expect(response.json().error.code).toBe('NOT_FOUND');
      }
      const row = await h.em().findOneOrFail(CrmOpportunityComment, { id: foreignNote.id }, { filters: false });
      expect(row.body).toBe('B keeps this.');
      expect(row.deletedAt ?? null).toBeNull();
    });
  });

  describe('no customer-facing route carries a note or a message', () => {
    it('keeps both out of the storefront order and quote-request endpoints of that Organization', async () => {
      const NOTE = 'crm-internal-note-7f3a';
      const MESSAGE = 'crm-internal-message-91bc';
      const opportunity = await createCrmOpportunity(h, { assignedAdminUserId: null });
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      await add(opportunity.id, 'note', NOTE);
      await add(opportunity.id, 'message', MESSAGE);

      // The customer of that Organization, on every route that shows them the
      // Order the Opportunity is linked to, and their quote requests.
      const customer = { b2b_session: 'stub-customer-session' };
      const urls = [
        '/api/v1/orders',
        `/api/v1/orders/${order.id}`,
        `/api/v1/orders/${order.id}/comments`,
        '/api/v1/quote-requests',
      ];
      let answered = 0;
      for (const url of urls) {
        const response = await h.app.inject({ method: 'GET', url, cookies: customer });
        if (response.statusCode === 200) answered += 1;
        expect(response.body, url).not.toContain(NOTE);
        expect(response.body, url).not.toContain(MESSAGE);
      }
      // Not vacuous: the customer really is shown that Order.
      expect(answered).toBeGreaterThanOrEqual(2);
      const shown = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, cookies: customer });
      expect(shown.statusCode, shown.body).toBe(200);

      // And the admin endpoint that does carry them is not a customer's to call.
      for (const kind of ['note', 'message']) {
        const response = await h.app.inject({
          method: 'GET',
          url: `${CRM_API}/opportunities/${opportunity.id}/comments?kind=${kind}`,
          cookies: customer,
        });
        expect([401, 403], `${kind} ${response.body}`).toContain(response.statusCode);
        expect(response.body).not.toContain(NOTE);
        expect(response.body).not.toContain(MESSAGE);
      }
    });
  });
});
