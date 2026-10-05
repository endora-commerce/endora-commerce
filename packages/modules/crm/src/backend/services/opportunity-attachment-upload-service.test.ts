import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDetail, AssetsLibraryPort, OpportunityAttachment } from '@endora-commerce/contracts';

const acting = vi.hoisted(() => ({ adminUserId: 'admin-1' as string | null, reachable: true }));

vi.mock('./opportunity-assignment-service.js', () => ({
  actingAdminUserId: () => acting.adminUserId,
}));
vi.mock('./opportunity-access.js', () => ({
  loadOpportunity: async () => {
    if (!acting.reachable) throw Object.assign(new Error('Opportunity not found.'), { statusCode: 404 });
    return { id: 'opportunity-1' };
  },
}));

const { OpportunityAttachmentUploadService } = await import('./opportunity-attachment-upload-service.js');

const FILE = { filename: 'offer.pdf', declaredMime: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4]) };
const ATTACHMENT = { id: 'attachment-1', assetId: 'asset-1' } as unknown as OpportunityAttachment;

function library() {
  const upload = vi.fn<AssetsLibraryPort['upload']>(async () => ({ id: 'asset-1' }) as AssetDetail);
  const softDelete = vi.fn<AssetsLibraryPort['softDelete']>(async () => ({
    deletedAt: new Date(),
    purgeAfterAt: new Date(),
  }));
  return { upload, softDelete, port: { upload, softDelete } as unknown as AssetsLibraryPort };
}

describe('OpportunityAttachmentUploadService', () => {
  beforeEach(() => {
    acting.adminUserId = 'admin-1';
    acting.reachable = true;
  });

  it('stores the file private, with its real size, and attaches the asset it was given', async () => {
    const assets = library();
    const attach = vi.fn(async () => ({ attachment: ATTACHMENT, created: true }));
    const service = new OpportunityAttachmentUploadService({
      emFactory: () => ({}) as never,
      assetsLibrary: assets.port,
      attach,
    });

    await expect(service.upload('opportunity-1', FILE)).resolves.toBe(ATTACHMENT);

    const input = assets.upload.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      filename: 'offer.pdf',
      declaredMime: 'application/pdf',
      declaredSize: 4,
      visibility: 'private',
      folderId: null,
      label: null,
    });
    const chunks: Array<string | Uint8Array> = [];
    for await (const chunk of input!.stream) chunks.push(chunk);
    expect(chunks).toEqual([FILE.bytes]);
    expect(attach).toHaveBeenCalledWith('opportunity-1', 'asset-1');
    expect(assets.softDelete).not.toHaveBeenCalled();
  });

  it('takes the stored file back when it could not be attached, and passes the failure on', async () => {
    const assets = library();
    const failure = new Error('the Opportunity was deleted meanwhile');
    const service = new OpportunityAttachmentUploadService({
      emFactory: () => ({}) as never,
      assetsLibrary: assets.port,
      attach: async () => {
        throw failure;
      },
    });

    await expect(service.upload('opportunity-1', FILE)).rejects.toBe(failure);
    expect(assets.softDelete).toHaveBeenCalledWith('asset-1');
  });

  it('stores nothing for an Opportunity the caller cannot see', async () => {
    acting.reachable = false;
    const assets = library();
    const service = new OpportunityAttachmentUploadService({
      emFactory: () => ({}) as never,
      assetsLibrary: assets.port,
      attach: async () => ({ attachment: ATTACHMENT, created: true }),
    });

    await expect(service.upload('opportunity-1', FILE)).rejects.toMatchObject({ statusCode: 404 });
    expect(assets.upload).not.toHaveBeenCalled();
  });

  it('stores nothing when nobody is behind the request', async () => {
    acting.adminUserId = null;
    const assets = library();
    const service = new OpportunityAttachmentUploadService({
      emFactory: () => ({}) as never,
      assetsLibrary: assets.port,
      attach: async () => ({ attachment: ATTACHMENT, created: true }),
    });

    await expect(service.upload('opportunity-1', FILE)).rejects.toMatchObject({ statusCode: 403 });
    expect(assets.upload).not.toHaveBeenCalled();
  });
});
