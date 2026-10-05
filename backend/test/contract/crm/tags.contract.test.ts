import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityDetailResponseSchema,
  OpportunityTagListResponseSchema,
  OpportunityTagResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CRM_ADMIN,
  CRM_API,
  clearCrmTags,
  createCrmOpportunity,
  createCrmTag,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
} from '../../helpers/seed-crm.js';

/**
 * Tags (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §8): the
 * five endpoints against their schemas. Managing the tag list is
 * `crm:configure`; tagging an Opportunity is `crm:write`; reading is
 * `crm:read`.
 */
describe('crm tags (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let worker: { cookies: { b2b_session: string }; undo: () => void };
  const MISSING = '00000000-0000-4000-8000-00000000dead';

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    await clearCrmTags(h.em());
    viewer = await seedCrmAdmin(h.em(), 'tag-viewer', ['crm:read']);
    worker = await seedCrmAdmin(h.em(), 'tag-worker', ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    viewer.undo();
    worker.undo();
    await clearCrmTags(h.em());
    await teardownBackendServer(h);
  });

  describe('POST /tags', () => {
    it('creates a tag — 201 with the tag, the default colour when none is given', async () => {
      const response = await call('POST', '/tags', { name: 'Key account' });
      expect(response.statusCode, response.body).toBe(201);
      const { data } = OpportunityTagResponseSchema.parse(response.json());
      expect(data).toMatchObject({ name: 'Key account', color: '#64748b', usageCount: 0 });

      const coloured = await call('POST', '/tags', { name: '  Tender  ', color: '#ef4444' });
      expect(coloured.statusCode, coloured.body).toBe(201);
      expect(OpportunityTagResponseSchema.parse(coloured.json()).data).toMatchObject({
        name: 'Tender',
        color: '#ef4444',
      });
    });

    it('refuses a name already taken, whatever its case — 409 CRM_TAG_NAME_TAKEN', async () => {
      const response = await call('POST', '/tags', { name: 'KEY ACCOUNT' });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_TAG_NAME_TAKEN');
    });

    it('refuses a body the schema does not accept — 400', async () => {
      for (const payload of [{}, { name: '' }, { name: 'x'.repeat(65) }, { name: 'ok', color: 'red' }]) {
        const response = await call('POST', '/tags', payload);
        expect(response.statusCode, `${JSON.stringify(payload)} ${response.body}`).toBe(400);
      }
    });

    it('is gated crm:configure — crm:write is not enough', async () => {
      const response = await call('POST', '/tags', { name: 'Gated' }, worker.cookies);
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  describe('GET /tags', () => {
    it('lists every tag by name, readable with crm:read alone', async () => {
      const response = await call('GET', '/tags', undefined, viewer.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityTagListResponseSchema.parse(response.json());
      expect(data.map((tag) => tag.name)).toEqual(['Key account', 'Tender']);
    });
  });

  describe('PATCH /tags/:id', () => {
    it('renames and recolours — 200 with the tag', async () => {
      const tag = await createCrmTag(h, 'Renamable');
      const response = await call('PATCH', `/tags/${tag.id}`, { name: 'Renamed', color: '#10b981' });
      expect(response.statusCode, response.body).toBe(200);
      expect(OpportunityTagResponseSchema.parse(response.json()).data).toMatchObject({
        id: tag.id,
        name: 'Renamed',
        color: '#10b981',
      });
      // Changing only the case of its own name is not a clash with itself.
      const recased = await call('PATCH', `/tags/${tag.id}`, { name: 'RENAMED' });
      expect(recased.statusCode, recased.body).toBe(200);
    });

    it('refuses a name another tag holds — 409 CRM_TAG_NAME_TAKEN', async () => {
      const tag = await createCrmTag(h, 'Collides');
      const response = await call('PATCH', `/tags/${tag.id}`, { name: 'tender' });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe('CRM_TAG_NAME_TAKEN');
    });

    it('answers 404 for a tag that does not exist, and is gated crm:configure', async () => {
      const missing = await call('PATCH', `/tags/${MISSING}`, { name: 'Nobody' });
      expect(missing.statusCode, missing.body).toBe(404);
      const tag = await createCrmTag(h, 'Patch gate');
      const refused = await call('PATCH', `/tags/${tag.id}`, { name: 'Nope' }, worker.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
    });
  });

  describe('DELETE /tags/:id', () => {
    it('deletes — 204; 404 afterwards; gated crm:configure', async () => {
      const tag = await createCrmTag(h, 'Deletable');
      const refused = await call('DELETE', `/tags/${tag.id}`, undefined, worker.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      const response = await call('DELETE', `/tags/${tag.id}`);
      expect(response.statusCode, response.body).toBe(204);
      const again = await call('DELETE', `/tags/${tag.id}`);
      expect(again.statusCode, again.body).toBe(404);
    });
  });

  describe('PUT /opportunities/:id/tags', () => {
    it('replaces the set and answers the Opportunity — crm:write is enough', async () => {
      const one = await createCrmTag(h, 'Put one');
      const two = await createCrmTag(h, 'Put two');
      const opportunity = await createCrmOpportunity(h);

      const first = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: [one.id, two.id] }, worker.cookies);
      expect(first.statusCode, first.body).toBe(200);
      expect(
        OpportunityDetailResponseSchema.parse(first.json()).data.tags.map((tag) => tag.name),
      ).toEqual(['Put one', 'Put two']);

      const second = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: [two.id] });
      expect(second.statusCode, second.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(second.json()).data.tags).toEqual([
        { id: two.id, name: 'Put two', color: two.color },
      ]);

      const cleared = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: [] });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(OpportunityDetailResponseSchema.parse(cleared.json()).data.tags).toEqual([]);
    });

    it('refuses a tag that does not exist — 422, nothing replaced', async () => {
      const tag = await createCrmTag(h, 'Kept');
      const opportunity = await createCrmOpportunity(h, { tagIds: [tag.id] });
      const response = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: [MISSING] });
      expect(response.statusCode, response.body).toBe(422);
      const detail = await call('GET', `/opportunities/${opportunity.id}`);
      expect(OpportunityDetailResponseSchema.parse(detail.json()).data.tags.map((t) => t.id)).toEqual([tag.id]);
    });

    it('answers 404 for an Opportunity that does not exist, 403 without crm:write, 400 for a malformed body', async () => {
      const opportunity = await createCrmOpportunity(h);
      const missing = await call('PUT', `/opportunities/${MISSING}/tags`, { tagIds: [] });
      expect(missing.statusCode, missing.body).toBe(404);
      expect(missing.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      const refused = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: [] }, viewer.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      const malformed = await call('PUT', `/opportunities/${opportunity.id}/tags`, { tagIds: ['nope'] });
      expect(malformed.statusCode, malformed.body).toBe(400);
    });
  });
});
