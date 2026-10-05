import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OpportunityAttachmentListResponseSchema,
  OpportunityAttachmentResponseSchema,
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
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
} from '../../helpers/seed-crm.js';

/**
 * Attachments (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7):
 * the three endpoints against their schemas, with their gates and refusals.
 * The bytes are in the media library before this API is called; it stores the
 * link.
 */
describe('crm attachments (contract)', () => {
  let h: BackendServerHandle;
  let viewer: { cookies: { b2b_session: string }; undo: () => void };
  let opportunityId: string;
  const assets: string[] = [];
  const MISSING = '00000000-0000-4000-8000-00000000dead';

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
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

  const asset = async (overrides: Parameters<typeof seedCrmAsset>[1] = {}) => {
    const seeded = await seedCrmAsset(h.em(), overrides);
    assets.push(seeded.id);
    return seeded;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    viewer = await seedCrmAdmin(h.em(), 'attachment-viewer', ['crm:read']);
    opportunityId = (await createCrmOpportunity(h)).id;
  });

  afterAll(async () => {
    viewer.undo();
    await removeCrmAssets(h.em(), assets);
    await teardownBackendServer(h);
  });

  describe('POST /opportunities/:id/attachments', () => {
    it('attaches a file of the media library — 201 with its name, type, size, uploader and a link', async () => {
      const file = await asset({ filename: 'signed-offer.pdf', sizeBytes: 4096 });
      const response = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId: file.id });
      expect(response.statusCode, response.body).toBe(201);
      const { data } = OpportunityAttachmentResponseSchema.parse(response.json());
      expect(data).toMatchObject({
        assetId: file.id,
        fileName: 'signed-offer.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        uploadedBy: { id: TEST_ADMIN_ID },
      });
      expect(data.url).toEqual(expect.stringContaining(file.id));
    });

    it('refuses a file that is not in the library, and one that is not private — 422', async () => {
      const open = await asset({ visibility: 'public' });
      for (const assetId of [MISSING, open.id]) {
        const response = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId });
        expect(response.statusCode, `${assetId} ${response.body}`).toBe(422);
        expect(response.json().error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses a body the schema does not accept — 400', async () => {
      for (const payload of [{}, { assetId: 'nope' }]) {
        const response = await call('POST', `/opportunities/${opportunityId}/attachments`, payload);
        expect(response.statusCode, `${JSON.stringify(payload)} ${response.body}`).toBe(400);
      }
    });

    it('is gated crm:write, and answers 404 for an Opportunity that does not exist', async () => {
      const file = await asset();
      const refused = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId: file.id }, viewer.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      const missing = await call('POST', `/opportunities/${MISSING}/attachments`, { assetId: file.id });
      expect(missing.statusCode, missing.body).toBe(404);
      expect(missing.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('GET /opportunities/:id/attachments', () => {
    it('lists them oldest first, readable — link included — with crm:read alone', async () => {
      const fresh = (await createCrmOpportunity(h)).id;
      const first = await asset({ filename: 'a.pdf' });
      const second = await asset({ filename: 'b.pdf' });
      for (const file of [first, second]) {
        expect((await call('POST', `/opportunities/${fresh}/attachments`, { assetId: file.id })).statusCode).toBe(201);
      }
      const response = await call('GET', `/opportunities/${fresh}/attachments`, undefined, viewer.cookies);
      expect(response.statusCode, response.body).toBe(200);
      const { data } = OpportunityAttachmentListResponseSchema.parse(response.json());
      expect(data.map((row) => row.fileName)).toEqual(['a.pdf', 'b.pdf']);
      for (const row of data) expect(row.url).toEqual(expect.any(String));
    });

    it('answers 404 for an Opportunity that does not exist', async () => {
      const response = await call('GET', `/opportunities/${MISSING}/attachments`);
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    });
  });

  describe('DELETE /opportunities/:id/attachments/:attachmentId', () => {
    it('removes — 204, 404 afterwards; gated crm:write', async () => {
      const file = await asset();
      const created = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId: file.id });
      const { id } = OpportunityAttachmentResponseSchema.parse(created.json()).data;
      const path = `/opportunities/${opportunityId}/attachments/${id}`;
      const refused = await call('DELETE', path, undefined, viewer.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      const response = await call('DELETE', path);
      expect(response.statusCode, response.body).toBe(204);
      const again = await call('DELETE', path);
      expect(again.statusCode, again.body).toBe(404);
      expect(again.json().error.code).toBe('NOT_FOUND');
    });
  });
});
