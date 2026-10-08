import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  OpportunityAttachmentListResponseSchema,
  OpportunityAttachmentResponseSchema,
  type AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { composeModules, createRootContainer, registerValues } from '@endora-commerce/platform/composition';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CrmOpportunityAttachment } from '../../helpers/package-entities.js';
import { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';
import { AssetsLibraryService } from '../../../../packages/modules/assets_library/src/backend/services/assets-library.service.js';
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

/**
 * Files attached to an Opportunity (User Story 5;
 * `specs/143-crm-sales-opportunities/research.md` R-15, N-B15, N-B16).
 *
 * The bytes live in the media library; an attachment is a link to one of its
 * files, held by value. Three things follow and are measured here: the library
 * refuses to delete a file an Opportunity uses — **also while `crm` is
 * switched off** — a person holding only CRM permissions can still download,
 * because the link is resolved by CRM, and that link is only ever handed out
 * under an Opportunity the caller may see.
 */
describe('crm attachments', () => {
  let h: BackendServerHandle;
  type Seeded = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let rep: Seeded;
  let crmOnly: Seeded;
  let organizationB: string;
  const assets: string[] = [];

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

  const attach = async (opportunityId: string, assetId: string, cookies?: Record<string, string>) => {
    const response = await call('POST', `/opportunities/${opportunityId}/attachments`, { assetId }, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return OpportunityAttachmentResponseSchema.parse(response.json()).data;
  };

  const list = async (opportunityId: string, cookies?: Record<string, string>) =>
    OpportunityAttachmentListResponseSchema.parse(
      (await call('GET', `/opportunities/${opportunityId}/attachments`, undefined, cookies)).json(),
    ).data;

  const registry = () => h.container.resolve<AssetReferenceRegistryPort>('assetReferenceRegistry');

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    organizationB = await seedCrmOrganization(h.em(), 'Attachments B');
    // `assets.read`: attaching a file by its id asks for the library's read
    // permission as well, and the isolation cases below are about what a
    // person who passes that gate still cannot reach.
    rep = await seedCrmSalesRep(h.em(), [TEST_ORGANIZATION_ID], ['crm:read', 'crm:write', 'orders:read', 'assets.read']);
    crmOnly = await seedCrmAdmin(h.em(), 'attachment-crm-only', ['crm:read', 'crm:write']);
  });

  afterAll(async () => {
    rep.undo();
    crmOnly.undo();
    await removeCrmAssets(h.em(), assets);
    await teardownBackendServer(h);
  });

  it('attaches an uploaded file, lists it with name, size and uploader, and removes it — each audited', async () => {
    const opportunity = await createCrmOpportunity(h);
    const file = await asset({ filename: 'technical-drawing.pdf', sizeBytes: 123_456 });

    // By somebody who may read the library: attaching by id asks for that too.
    const attached = await attach(opportunity.id, file.id, rep.cookies);
    expect(attached.uploadedBy.id).toBe(rep.adminUserId);

    const listed = await list(opportunity.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: attached.id,
      assetId: file.id,
      fileName: 'technical-drawing.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123_456,
      uploadedBy: attached.uploadedBy,
    });

    const removed = await call('DELETE', `/opportunities/${opportunity.id}/attachments/${attached.id}`);
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await list(opportunity.id)).toEqual([]);

    const added = await h.auditLogService.query({ action: 'crm.opportunity.attachment_add', objectId: opportunity.id });
    const gone = await h.auditLogService.query({ action: 'crm.opportunity.attachment_remove', objectId: opportunity.id });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      objectType: 'crm_opportunity',
      stateAfter: { attachmentId: attached.id, assetId: file.id, fileName: 'technical-drawing.pdf' },
    });
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ stateBefore: { attachmentId: attached.id, assetId: file.id } });
  });

  it('does not attach the same file to an Opportunity twice', async () => {
    const opportunity = await createCrmOpportunity(h);
    const file = await asset();
    const first = await attach(opportunity.id, file.id);

    const again = await call('POST', `/opportunities/${opportunity.id}/attachments`, { assetId: file.id });
    // Answered with the attachment that exists; nothing is written.
    expect(again.statusCode, again.body).toBe(200);
    expect(OpportunityAttachmentResponseSchema.parse(again.json()).data.id).toBe(first.id);
    expect(await h.em().count(CrmOpportunityAttachment, { opportunityId: opportunity.id }, { filters: false })).toBe(1);
    expect(
      await h.auditLogService.query({ action: 'crm.opportunity.attachment_add', objectId: opportunity.id }),
    ).toHaveLength(1);
  });

  it('refuses a file that is not private — the admin uploads an attachment as private', async () => {
    const opportunity = await createCrmOpportunity(h);
    const open = await asset({ visibility: 'public' });
    const response = await call('POST', `/opportunities/${opportunity.id}/attachments`, { assetId: open.id });
    expect(response.statusCode, response.body).toBe(422);
    expect(await list(opportunity.id)).toEqual([]);
  });

  describe('the download link', () => {
    it('is resolved by CRM, so somebody holding only CRM permissions can download', async () => {
      const opportunity = await createCrmOpportunity(h);
      const file = await asset();
      await attach(opportunity.id, file.id);

      // The library's own admin API is not theirs to call…
      const library = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/assets/${file.id}`,
        cookies: crmOnly.cookies,
      });
      expect(library.statusCode, library.body).toBe(403);

      // …and the Opportunity's attachment list hands them a signed link all the same.
      const [row] = await list(opportunity.id, crmOnly.cookies);
      expect(row?.url).toEqual(expect.stringContaining(file.id));
      expect(row?.url).toMatch(/[?&]token=/);
      expect(row?.url).toMatch(/[?&]exp=\d+/);
    });
  });

  describe('deletion protection', () => {
    it('reports the Opportunity as a reference while attached, and not after removal', async () => {
      const opportunity = await createCrmOpportunity(h);
      const file = await asset();
      expect(registry().owners()).toContain('crm');
      expect(await registry().findReferences(file.id)).toEqual([]);

      const attached = await attach(opportunity.id, file.id);
      const references = await registry().findReferences(file.id);
      expect(references).toEqual([
        {
          kind: 'crm_opportunity_attachment',
          entityId: opportunity.id,
          // The number, not the title: whoever is deleting a file in the
          // library need not be somebody who may read the Opportunity.
          label: `Sales opportunity ${opportunity.number}`,
        },
      ]);
      // The library itself refuses, through its own admin API.
      const refused = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${file.id}`, cookies: CRM_ADMIN });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_REFERENCED);

      expect((await call('DELETE', `/opportunities/${opportunity.id}/attachments/${attached.id}`)).statusCode).toBe(204);
      expect(await registry().findReferences(file.id)).toEqual([]);
    });

    it('still reports the reference while crm is deactivated', async () => {
      const opportunity = await createCrmOpportunity(h);
      const file = await asset();
      await attach(opportunity.id, file.id);
      await withModuleOff('crm', 'deactivated', async () => {
        const references = await registry().findReferences(file.id);
        expect(references.map((reference) => reference.kind)).toEqual(['crm_opportunity_attachment']);
      });
    });

    /**
     * The assertion that decides whether the boot hook is a contribution or
     * work (`backend/test/integration/blog/asset-reference-while-off.test.ts`
     * is the model, and says why at length): `crm` is composed **while it is
     * off**, against a registry of its own, and the Library is then asked to
     * delete a file an Opportunity uses.
     */
    describe('after booting with crm deactivated', () => {
      const libraryOver = (own: AssetReferenceRegistry): AssetsLibraryService =>
        new AssetsLibraryService({
          emFactory: () => h.em(),
          adapters: h.assetsLibrary.adapters,
          referenceRegistry: own,
          loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
        });

      async function bootCrmInto(own: AssetReferenceRegistry): Promise<void> {
        // The published artefact, by bare specifier — the copy the composed
        // platform holds. A path into the package's source would evaluate the
        // module a second time (`check:singleton-identity`).
        const { registerModule } = await import('@endora-commerce/mod-crm/backend');
        const container = createRootContainer();
        registerValues(container, {
          emFactory: () => h.em(),
          assetReferenceRegistry: own,
          // `sales_channels` owns this one and is not composed here; the
          // module's other contribution hook pushes into it.
          salesChannelAttributionRegistry: { register: () => undefined, owners: () => [] },
          // `audit_logs` owns this one, the module's third boot-hook push.
          auditReferenceRegistry: { register: () => undefined, owners: () => [], resolve: async () => new Map() },
          // `transactional_emails` owns this one, the fourth push: the default
          // subject and body of the Event reminder e-mail.
          emailDefaultsPort: { register: () => undefined },
        });
        const composed = composeModules([{ id: 'crm', version: '1.0.0', registerModule }], {
          container,
          eventBus: new EventBus(),
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });
        await composed.runBootHooks();
      }

      it('refuses the delete, naming the crm edge', async () => {
        const opportunity = await createCrmOpportunity(h);
        const file = await asset();
        await attach(opportunity.id, file.id);
        const own = new AssetReferenceRegistry();

        await withModuleOff('crm', 'deactivated', async () => {
          await bootCrmInto(own);
          expect(
            own.owners(),
            'a deployment that boots with `crm` off registered no crm scanner, so nothing stands ' +
              'between an operator and a file a deactivated Opportunity still uses',
          ).toContain('crm');
          await expect(libraryOver(own).softDelete(file.id)).rejects.toMatchObject({
            statusCode: 409,
            code: ERROR_CODES.ASSET_REFERENCED,
          });
          expect((await own.findReferences(file.id)).map((reference) => reference.kind)).toContain(
            'crm_opportunity_attachment',
          );
        });

        // The control: the same delete succeeds with no scanner registered.
        const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(file.id);
        expect(deleted.deletedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for the attachments of an Opportunity out of reach — list, attach, remove', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      const file = await asset();
      const attached = await attach(foreign.id, file.id);
      const other = await asset();
      const base = `/opportunities/${foreign.id}/attachments`;

      for (const response of [
        await call('GET', base, undefined, rep.cookies),
        await call('POST', base, { assetId: other.id }, rep.cookies),
        await call('DELETE', `${base}/${attached.id}`, undefined, rep.cookies),
      ]) {
        expect(response.statusCode, response.body).toBe(404);
        expect(response.json().error.code).toBe('CRM_OPPORTUNITY_NOT_FOUND');
        expect(response.body).not.toContain('token=');
      }
      expect((await list(foreign.id)).map((row) => row.id)).toEqual([attached.id]);
    });

    it('answers 404 for an attachment of B addressed under an Opportunity of A', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      const own = await createCrmOpportunity(h);
      const attached = await attach(foreign.id, (await asset()).id);

      for (const cookies of [rep.cookies, CRM_ADMIN]) {
        const response = await call('DELETE', `/opportunities/${own.id}/attachments/${attached.id}`, undefined, cookies);
        expect(response.statusCode, response.body).toBe(404);
        expect(response.json().error.code).toBe('NOT_FOUND');
      }
      expect(await h.em().count(CrmOpportunityAttachment, { id: attached.id }, { filters: false })).toBe(1);
    });

    it('does not hand out a link to B\'s file by attaching it to an Opportunity of A', async () => {
      const foreign = await createCrmOpportunity(h, { organizationId: organizationB });
      const own = await createCrmOpportunity(h);
      const file = await asset();
      await attach(foreign.id, file.id);

      // The rep knows the asset id and tries to attach it where they can read.
      const response = await call('POST', `/opportunities/${own.id}/attachments`, { assetId: file.id }, rep.cookies);
      // The same answer as for a file that does not exist.
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
      expect(response.body).not.toContain('token=');
      expect(await list(own.id, rep.cookies)).toEqual([]);

      // An administrator who reaches both Opportunities may share the file between them.
      const shared = await call('POST', `/opportunities/${own.id}/attachments`, { assetId: file.id });
      expect(shared.statusCode, shared.body).toBe(201);
    });
  });

  it('keeps the attachment row readable when the file is gone from the library', async () => {
    const opportunity = await createCrmOpportunity(h);
    const file = await asset({ filename: 'vanished.pdf' });
    const attached = await attach(opportunity.id, file.id);
    // Not reachable through the library while attached — forced here, as a
    // restore from an older backup would.
    await removeCrmAssets(h.em(), [file.id]);

    const [row] = await list(opportunity.id);
    expect(row).toMatchObject({ id: attached.id, fileName: 'vanished.pdf', sizeBytes: 0, url: null });
    expect(row?.uploadedBy.id).toBe(TEST_ADMIN_ID);
  });

  describe('a document a browser would render and run is not an attachment (review finding 1)', () => {
    it.each([
      { filename: 'offer.html', mimeType: 'text/html' },
      { filename: 'logo.svg', mimeType: 'image/svg+xml' },
      { filename: 'offer.html', mimeType: 'text/plain' },
      { filename: 'offer.txt', mimeType: 'text/html' },
    ])('refuses to attach a library file $filename stored as $mimeType — 415', async (overrides) => {
      const opportunity = await createCrmOpportunity(h);
      const file = await asset(overrides);
      const response = await call('POST', `/opportunities/${opportunity.id}/attachments`, { assetId: file.id });
      expect(response.statusCode, response.body).toBe(415);
      expect(response.json().error.code).toBe('ASSET_UPLOAD_TYPE_NOT_ALLOWED');
      expect(await list(opportunity.id)).toEqual([]);
    });

    it('hands the link out as a download, never as a page to render', async () => {
      const opportunity = await createCrmOpportunity(h);
      const file = await asset();
      await attach(opportunity.id, file.id);
      const [row] = await list(opportunity.id);
      expect(row?.url).toMatch(/[?&]download=1(&|$)/);
      expect(row?.url).toMatch(/[?&]token=/);
    });
  });
});
