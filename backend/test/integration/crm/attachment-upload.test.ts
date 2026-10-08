import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  OpportunityAttachmentListResponseSchema,
  OpportunityAttachmentResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Asset, CrmOpportunityAttachment } from '../../helpers/package-entities.js';
import {
  CRM_ADMIN,
  CRM_API,
  createCrmOpportunity,
  removeCrmAssets,
  restoreDefaultCrmWorkflow,
  seedCrmAdmin,
  seedCrmAsset,
  seedCrmOrganization,
  seedCrmSalesRep,
} from '../../helpers/seed-crm.js';
import {
  TINY_PNG,
  overrideAssetSetting,
  uploadCrmAttachment,
  useTemporaryAssetStore,
} from '../../helpers/crm-attachment-upload.js';

/**
 * Adding a file to an Opportunity without being a media-library editor
 * (`specs/143-crm-sales-opportunities/research.md` N-D8, N-F1).
 *
 * The upload is CRM's route and CRM's gate; the bytes go to the media library
 * through its published port, so what a file may be — its size, its type —
 * stays the library's to say, and is said here in the library's own words.
 */
describe('crm attachment upload', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let rep: Seeded;
  let crmOnly: Seeded;
  let withLibrary: Seeded;
  let organizationB: string;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const assets: string[] = [];

  const list = async (opportunityId: string, cookies: Record<string, string> = CRM_ADMIN) =>
    OpportunityAttachmentListResponseSchema.parse(
      (
        await h.app.inject({
          method: 'GET',
          url: `${CRM_API}/opportunities/${opportunityId}/attachments`,
          cookies,
        })
      ).json(),
    ).data;

  const upload = async (
    opportunityId: string,
    file: { filename: string; mime?: string; value: Buffer | string },
    cookies?: Record<string, string>,
  ) => {
    const response = await uploadCrmAttachment(h, opportunityId, file, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = OpportunityAttachmentResponseSchema.parse(response.json());
    assets.push(data.assetId);
    return data;
  };

  /** Everything the library holds under a name — a refused upload must leave none. */
  const assetsNamed = (filename: string) => h.em().count(Asset, { filename });

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    store = await useTemporaryAssetStore(h);
    organizationB = await seedCrmOrganization(h.em(), 'Upload B');
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write', 'orders:read']);
    crmOnly = await seedCrmAdmin(h.em(), 'upload-crm-only', ['crm:read', 'crm:write']);
    withLibrary = await seedCrmAdmin(h.em(), 'upload-with-library', ['crm:read', 'crm:write', 'assets.read']);
  });

  afterAll(async () => {
    rep.undo();
    crmOnly.undo();
    withLibrary.undo();
    await removeCrmAssets(h.em(), assets);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('lets somebody holding only CRM permissions upload, download and remove a file — each write audited', async () => {
    const opportunity = await createCrmOpportunity(h);
    const bytes = Buffer.from('Scope of delivery: 40 pallets, weekly.\n');

    const attached = await upload(
      opportunity.id,
      { filename: 'scope.txt', mime: 'text/plain', value: bytes },
      crmOnly.cookies,
    );
    expect(attached).toMatchObject({
      fileName: 'scope.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      uploadedBy: { id: crmOnly.adminUserId },
    });

    // Download: the link the list answers now, opened with no session at all —
    // it is the signature that admits, and it names this file only.
    const [row] = await list(opportunity.id, crmOnly.cookies);
    expect(row?.id).toBe(attached.id);
    const link = new URL(row?.url ?? '');
    const downloaded = await h.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.equals(bytes)).toBe(true);
    const unsigned = await h.app.inject({ method: 'GET', url: link.pathname });
    expect(unsigned.statusCode, 'a private file is not served without its signature').toBe(403);

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `${CRM_API}/opportunities/${opportunity.id}/attachments/${attached.id}`,
      cookies: crmOnly.cookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await list(opportunity.id)).toEqual([]);

    const added = await h.auditLogService.query({ action: 'crm.opportunity.attachment_add', objectId: opportunity.id });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      objectType: 'crm_opportunity',
      stateAfter: { attachmentId: attached.id, assetId: attached.assetId, fileName: 'scope.txt' },
    });
    // The library's half of the write is the library's entry.
    const stored = await h.auditLogService.query({ action: 'asset.upload', objectId: attached.assetId });
    expect(stored).toHaveLength(1);
  });

  it('keeps a private file of the library out of reach of crm:write alone — attaching by id asks for assets.read', async () => {
    const opportunity = await createCrmOpportunity(h);
    // A private file of the library, attached to nothing, whose id is known.
    const file = await seedCrmAsset(h.em());
    assets.push(file.id);
    const attachById = (cookies: Record<string, string>) =>
      h.app.inject({
        method: 'POST',
        url: `${CRM_API}/opportunities/${opportunity.id}/attachments`,
        cookies,
        payload: { assetId: file.id },
      });

    const refused = await attachById(crmOnly.cookies);
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(refused.body).not.toContain('token=');
    // Nothing was attached, so the list hands out no signed link to it.
    expect(await list(opportunity.id, crmOnly.cookies)).toEqual([]);
    expect(await h.em().count(CrmOpportunityAttachment, { opportunityId: opportunity.id })).toBe(0);

    // The upload is unchanged: CRM's own code is still enough to add a file.
    const uploaded = await upload(
      opportunity.id,
      { filename: 'own-file.png', mime: 'image/png', value: TINY_PNG },
      crmOnly.cookies,
    );
    expect((await list(opportunity.id, crmOnly.cookies)).map((row) => row.id)).toEqual([uploaded.id]);

    // Somebody who may read the library may attach what they could already open there.
    const allowed = await attachById(withLibrary.cookies);
    expect(allowed.statusCode, allowed.body).toBe(201);
    expect(OpportunityAttachmentResponseSchema.parse(allowed.json()).data.assetId).toBe(file.id);
  });

  it('is protected from deletion in the library like any other attachment', async () => {
    const opportunity = await createCrmOpportunity(h);
    const attached = await upload(opportunity.id, { filename: 'kept.png', mime: 'image/png', value: TINY_PNG });
    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${attached.assetId}`,
      cookies: CRM_ADMIN,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
  });

  describe('what a file may be is the media library\'s to say', () => {
    it('passes on the library\'s refusal of a file type — 415, nothing stored, nothing attached', async () => {
      const opportunity = await createCrmOpportunity(h);
      const restore = await overrideAssetSetting(h, 'assets.allowed_file_types', ['png', 'pdf']);
      try {
        const refused = await uploadCrmAttachment(
          h,
          opportunity.id,
          { filename: 'macro.txt', mime: 'text/plain', value: 'not allowed here' },
          crmOnly.cookies,
        );
        expect(refused.statusCode, refused.body).toBe(415);
        expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);

        // The control: a type the policy admits goes through under the same policy.
        await upload(opportunity.id, { filename: 'allowed.png', mime: 'image/png', value: TINY_PNG }, crmOnly.cookies);
      } finally {
        await restore();
      }
      expect(await assetsNamed('macro.txt')).toBe(0);
      expect((await list(opportunity.id)).map((row) => row.fileName)).toEqual(['allowed.png']);
    });

    it('passes on the library\'s size limit as it is set now — 413, nothing stored, nothing attached', async () => {
      const opportunity = await createCrmOpportunity(h);
      const restore = await overrideAssetSetting(h, 'assets.max_file_size_mb', 1);
      try {
        const refused = await uploadCrmAttachment(
          h,
          opportunity.id,
          { filename: 'two-megabytes.bin', value: Buffer.alloc(2 * 1024 * 1024, 0x41) },
          crmOnly.cookies,
        );
        expect(refused.statusCode, refused.body).toBe(413);
        expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TOO_LARGE);

        await upload(opportunity.id, { filename: 'small.bin', value: Buffer.alloc(1024, 0x41) }, crmOnly.cookies);
      } finally {
        await restore();
      }
      expect(await assetsNamed('two-megabytes.bin')).toBe(0);
      expect((await list(opportunity.id)).map((row) => row.fileName)).toEqual(['small.bin']);
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for an Opportunity out of reach and stores nothing — the parent is asked first', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      const own = await createCrmOpportunity(h);

      const refused = await uploadCrmAttachment(
        h,
        foreign.id,
        { filename: 'out-of-reach.png', mime: 'image/png', value: TINY_PNG },
        rep.cookies,
      );
      expect(refused.statusCode, refused.body).toBe(404);
      expect(refused.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
      expect(refused.body).not.toContain('token=');
      expect(await assetsNamed('out-of-reach.png')).toBe(0);
      expect(await h.em().count(CrmOpportunityAttachment, { opportunityId: foreign.id }, { filters: false })).toBe(0);

      // The control: the same person, the same file, an Opportunity of their own.
      const attached = await upload(own.id, { filename: 'in-reach.png', mime: 'image/png', value: TINY_PNG }, rep.cookies);
      expect(attached.uploadedBy.id).toBe(rep.adminUserId);
    });

    it('does not show a file uploaded under B to somebody confined to A', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      await upload(foreign.id, { filename: 'theirs.png', mime: 'image/png', value: TINY_PNG });
      const response = await h.app.inject({
        method: 'GET',
        url: `${CRM_API}/opportunities/${foreign.id}/attachments`,
        cookies: rep.cookies,
      });
      expect(response.statusCode, response.body).toBe(404);
      expect(response.body).not.toContain('theirs.png');
    });
  });

  describe('a document a browser would render and run is not an attachment (review finding 1)', () => {
    const page = '<!doctype html><script>fetch("/api/v1/admin/crm/opportunities",{credentials:"include"})</script>';

    it.each([
      { filename: 'offer.html', mime: 'text/html', value: page },
      { filename: 'offer.htm', mime: 'application/octet-stream', value: page },
      { filename: 'logo.svg', mime: 'image/svg+xml', value: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' },
      { filename: 'feed.xml', mime: 'application/xml', value: '<?xml version="1.0"?><a/>' },
      { filename: 'app.js', mime: 'text/javascript', value: 'alert(1)' },
      // The mismatches: either the name or the declared type is enough.
      { filename: 'offer.html', mime: 'text/plain', value: page },
      { filename: 'offer.txt', mime: 'text/html', value: page },
    ])('refuses $filename declared $mime — 415, nothing stored, nothing attached', async (file) => {
      const opportunity = await createCrmOpportunity(h);
      const name = `refused-${Date.now()}-${file.filename}`;
      const refused = await uploadCrmAttachment(h, opportunity.id, { ...file, filename: name }, crmOnly.cookies);
      expect(refused.statusCode, refused.body).toBe(415);
      expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      expect(await assetsNamed(name)).toBe(0);
      expect(await list(opportunity.id)).toEqual([]);
    });

    it('still takes a PDF and a PNG, and hands their links out as downloads', async () => {
      const opportunity = await createCrmOpportunity(h);
      await upload(
        opportunity.id,
        { filename: 'offer.pdf', mime: 'application/pdf', value: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n') },
        crmOnly.cookies,
      );
      await upload(opportunity.id, { filename: 'photo.png', mime: 'image/png', value: TINY_PNG }, crmOnly.cookies);
      const rows = await list(opportunity.id, crmOnly.cookies);
      expect(rows.map((row) => row.fileName)).toEqual(['offer.pdf', 'photo.png']);

      for (const row of rows) {
        const link = new URL(row.url ?? '');
        expect(link.searchParams.get('download')).toBe('1');
        const served = await h.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
        expect(served.statusCode, served.body).toBe(200);
        expect(String(served.headers['content-disposition'])).toMatch(/^attachment;/);
      }
    });
  });
});
