import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_ATTACHMENT_MAX_BYTES,
  OpportunityAttachmentResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
} from '../../helpers/seed-crm.js';
import {
  TINY_PNG,
  multipartBody,
  uploadCrmAttachment,
  useTemporaryAssetStore,
} from '../../helpers/crm-attachment-upload.js';

/**
 * `POST /opportunities/:id/attachments/upload`
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7a): one
 * multipart request that stores the file in the media library as a private
 * asset and attaches it — gated by CRM's own code, so adding a file to an
 * Opportunity asks for nothing of the media library's.
 */
describe('crm attachment upload (contract)', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let viewer: Seeded;
  let writer: Seeded;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let opportunityId: string;
  const assets: string[] = [];
  const MISSING = '00000000-0000-4000-8000-00000000dead';
  const uploadUrl = (id: string) => `${CRM_API}/opportunities/${id}/attachments/upload`;

  const assetsNamed = (filename: string) => h.em().count(Asset, { filename });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    store = await useTemporaryAssetStore(h);
    viewer = await seedCrmAdmin(h.em(), 'upload-viewer', ['crm:read']);
    // Exactly the two codes a Sales Rep holds — and none of the media library's.
    writer = await seedCrmAdmin(h.em(), 'upload-writer', ['crm:read', 'crm:write']);
    opportunityId = (await createCrmOpportunity(h)).id;
  });

  afterAll(async () => {
    viewer.undo();
    writer.undo();
    await removeCrmAssets(h.em(), assets);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('stores the file as a private asset and attaches it — 201 with the attachment', async () => {
    const response = await uploadCrmAttachment(
      h,
      opportunityId,
      { filename: 'site-photo.png', mime: 'image/png', value: TINY_PNG },
      writer.cookies,
    );
    expect(response.statusCode, response.body).toBe(201);
    const { data } = OpportunityAttachmentResponseSchema.parse(response.json());
    assets.push(data.assetId);
    expect(data).toMatchObject({
      fileName: 'site-photo.png',
      mimeType: 'image/png',
      sizeBytes: TINY_PNG.length,
      uploadedBy: { id: writer.adminUserId },
    });
    expect(data.url).toMatch(/[?&]token=/);

    const stored = await h.em().findOneOrFail(Asset, { id: data.assetId });
    expect(stored.visibility).toBe('private');

    const listed = await h.app.inject({
      method: 'GET',
      url: `${CRM_API}/opportunities/${opportunityId}/attachments`,
      cookies: writer.cookies,
    });
    expect((listed.json() as { data: Array<{ id: string }> }).data.map((row) => row.id)).toEqual([data.id]);
  });

  it('is gated crm:write — and the media library still refuses that role its own upload', async () => {
    const refused = await uploadCrmAttachment(
      h,
      opportunityId,
      { filename: 'refused.png', mime: 'image/png', value: TINY_PNG },
      viewer.cookies,
    );
    expect(refused.statusCode, refused.body).toBe(403);
    expect(await assetsNamed('refused.png')).toBe(0);

    // The control: nothing was opened in the library for the people CRM admits.
    const { body, contentType } = multipartBody([
      { name: 'visibility', value: 'private' },
      { name: 'file', filename: 'library.png', mime: 'image/png', value: TINY_PNG },
    ]);
    const library = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: writer.cookies,
      payload: body,
    });
    expect(library.statusCode, library.body).toBe(403);
  });

  it('answers 404 for an Opportunity that does not exist, and stores nothing', async () => {
    const response = await uploadCrmAttachment(h, MISSING, {
      filename: 'nowhere.png',
      mime: 'image/png',
      value: TINY_PNG,
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
    expect(await assetsNamed('nowhere.png')).toBe(0);
  });

  it('refuses a request that carries no file — 400', async () => {
    const json = await h.app.inject({
      method: 'POST',
      url: uploadUrl(opportunityId),
      cookies: CRM_ADMIN,
      payload: { assetId: MISSING },
    });
    expect(json.statusCode, json.body).toBe(400);
    expect(json.json().error.code).toBe('VALIDATION_FAILED');

    const { body, contentType } = multipartBody([{ name: 'label', value: 'no file here' }]);
    const empty = await h.app.inject({
      method: 'POST',
      url: uploadUrl(opportunityId),
      headers: { 'content-type': contentType },
      cookies: CRM_ADMIN,
      payload: body,
    });
    expect(empty.statusCode, empty.body).toBe(400);
    expect(empty.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a file larger than an attachment may be — 413 CRM_ATTACHMENT_TOO_LARGE', async () => {
    const response = await uploadCrmAttachment(h, opportunityId, {
      filename: 'too-large.bin',
      value: Buffer.alloc(OPPORTUNITY_ATTACHMENT_MAX_BYTES + 1, 0x41),
    });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(413);
    expect(response.json().error.code).toBe('CRM_ATTACHMENT_TOO_LARGE');
    expect(await assetsNamed('too-large.bin')).toBe(0);
  });
});
