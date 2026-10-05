import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityCommentListResponseSchema,
  OpportunityCommentResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
} from '../../helpers/seed-crm.js';

/**
 * Notes and messages
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §6): the four
 * endpoints against their schemas, with their gates and their refusals.
 */
describe('crm notes and messages (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let opportunityId: string;
  const MISSING = '00000000-0000-4000-8000-00000000dead';

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

  const add = async (kind: 'note' | 'message', body: string) => {
    const response = await call('POST', `/opportunities/${opportunityId}/comments`, { kind, body });
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityCommentResponseSchema.parse(response.json()).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    viewer = await seedCrmAdmin(h.em(), 'comment-viewer', ['crm:read']);
    opportunityId = (await createCrmOpportunity(h)).id;
  });

  afterAll(async () => {
    viewer.undo();
    await teardownBackendServer(h);
  });

  describe('POST /opportunities/:id/comments', () => {
    it('adds a note — 201 with the comment and its author', async () => {
      const note = await add('note', 'Call back on Monday.');
      expect(note).toMatchObject({
        kind: 'note',
        body: 'Call back on Monday.',
        author: { id: TEST_ADMIN_ID },
        references: [],
        editedAt: null,
      });
      expect(note.author.name.length).toBeGreaterThan(0);
    });

    it('adds a message — 201', async () => {
      expect(await add('message', 'Who is taking this one?')).toMatchObject({
        kind: 'message',
        body: 'Who is taking this one?',
        editedAt: null,
      });
    });

    it('refuses a body the schema does not accept — 400', async () => {
      for (const payload of [{}, { kind: 'note' }, { kind: 'note', body: '' }, { kind: 'memo', body: 'x' }]) {
        const response = await call('POST', `/opportunities/${opportunityId}/comments`, payload);
        expect(response.statusCode, `${JSON.stringify(payload)} ${response.body}`).toBe(400);
      }
    });

    it('is gated crm:write, and answers 404 for an Opportunity that does not exist', async () => {
      const refused = await call(
        'POST',
        `/opportunities/${opportunityId}/comments`,
        { kind: 'note', body: 'x' },
        viewer.cookies,
      );
      expect(refused.statusCode, refused.body).toBe(403);
      const missing = await call('POST', `/opportunities/${MISSING}/comments`, { kind: 'note', body: 'x' });
      expect(missing.statusCode, missing.body).toBe(404);
      expect(missing.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('GET /opportunities/:id/comments?kind=', () => {
    it('lists one kind, oldest first, readable with crm:read alone', async () => {
      const fresh = (await createCrmOpportunity(h)).id;
      for (const body of ['first', 'second', 'third']) {
        expect((await call('POST', `/opportunities/${fresh}/comments`, { kind: 'note', body })).statusCode).toBe(201);
      }
      expect((await call('POST', `/opportunities/${fresh}/comments`, { kind: 'message', body: 'm' })).statusCode).toBe(201);

      const notes = await call('GET', `/opportunities/${fresh}/comments?kind=note`, undefined, viewer.cookies);
      expect(notes.statusCode, notes.body).toBe(200);
      expect(OpportunityCommentListResponseSchema.parse(notes.json()).data.map((c) => c.body)).toEqual([
        'first',
        'second',
        'third',
      ]);
      const messages = await call('GET', `/opportunities/${fresh}/comments?kind=message`);
      expect(OpportunityCommentListResponseSchema.parse(messages.json()).data.map((c) => c.body)).toEqual(['m']);
    });

    it('requires the kind — 400 without it, 400 for one that does not exist', async () => {
      for (const query of ['', '?kind=memo']) {
        const response = await call('GET', `/opportunities/${opportunityId}/comments${query}`);
        expect(response.statusCode, `${query} ${response.body}`).toBe(400);
      }
    });

    it('answers 404 for an Opportunity that does not exist', async () => {
      const response = await call('GET', `/opportunities/${MISSING}/comments?kind=note`);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('PATCH /opportunities/:id/comments/:commentId', () => {
    it('edits a note — 200 with editedAt set', async () => {
      const note = await add('note', 'Draft');
      const response = await call('PATCH', `/opportunities/${opportunityId}/comments/${note.id}`, { body: 'Final' });
      expect(response.statusCode, response.body).toBe(200);
      const edited = OpportunityCommentResponseSchema.parse(response.json()).data;
      expect(edited).toMatchObject({ id: note.id, kind: 'note', body: 'Final' });
      expect(edited.editedAt).toEqual(expect.any(String));
    });

    it('refuses to edit a message — 409 CRM_MESSAGE_IMMUTABLE', async () => {
      const message = await add('message', 'As sent.');
      const response = await call('PATCH', `/opportunities/${opportunityId}/comments/${message.id}`, { body: 'Changed' });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_MESSAGE_IMMUTABLE');
    });

    it('answers 404 for a comment that does not exist, 400 for an empty body, 403 without crm:write', async () => {
      const note = await add('note', 'Gate');
      const missing = await call('PATCH', `/opportunities/${opportunityId}/comments/${MISSING}`, { body: 'x' });
      expect(missing.statusCode, missing.body).toBe(404);
      const malformed = await call('PATCH', `/opportunities/${opportunityId}/comments/${note.id}`, { body: '' });
      expect(malformed.statusCode, malformed.body).toBe(400);
      const refused = await call(
        'PATCH',
        `/opportunities/${opportunityId}/comments/${note.id}`,
        { body: 'x' },
        viewer.cookies,
      );
      expect(refused.statusCode, refused.body).toBe(403);
    });
  });

  describe('DELETE /opportunities/:id/comments/:commentId', () => {
    it('deletes a note — 204, and 404 afterwards', async () => {
      const note = await add('note', 'Short-lived');
      const response = await call('DELETE', `/opportunities/${opportunityId}/comments/${note.id}`);
      expect(response.statusCode, response.body).toBe(204);
      const again = await call('DELETE', `/opportunities/${opportunityId}/comments/${note.id}`);
      expect(again.statusCode, again.body).toBe(404);
    });

    it('refuses to delete a message — 409 CRM_MESSAGE_IMMUTABLE', async () => {
      const message = await add('message', 'Stays.');
      const response = await call('DELETE', `/opportunities/${opportunityId}/comments/${message.id}`);
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_MESSAGE_IMMUTABLE');
    });
  });
});
