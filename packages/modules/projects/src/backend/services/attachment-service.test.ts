import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetRecord } from '@endora-commerce/contracts';
import {
  ProjectAttachmentService,
  type ProjectAttachmentServiceDeps,
} from './attachment-service.js';

/**
 * Issue #545: the list builds every file's download link in **one** batched
 * read (`assetReadPort.resolveUrls`) — never a full asset detail per file,
 * whose "used by" list asks every reference descriptor about that one file.
 */
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
const assetIds = [
  '00000000-0000-4000-8000-0000000000f1',
  '00000000-0000-4000-8000-0000000000f2',
  '00000000-0000-4000-8000-0000000000f3',
];
const GONE = '00000000-0000-4000-8000-0000000000f9';

function record(id: string): AssetRecord {
  return { id, filename: `${id}.pdf`, mimeType: 'application/pdf', sizeBytes: '10' } as AssetRecord;
}

function makeService() {
  const rows = [...assetIds, GONE].map((assetId, index) => ({
    id: `00000000-0000-4000-8000-00000000010${index}`,
    projectId: PROJECT_ID,
    assetId,
    addedByAdminUserId: ADMIN_ID,
    addedAt: new Date('2026-11-01T10:00:00Z'),
  }));
  const resolveUrls = vi.fn(
    async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, `https://api.example.test/api/v1/assets/file/${id}?sig=abc`])),
  );
  const getAsset = vi.fn();
  const deps = {
    emFactory: () => ({ find: async () => rows }) as unknown as EntityManager,
    commandBus: {} as ProjectAttachmentServiceDeps['commandBus'],
    access: {
      loadVisible: async () => ({ id: PROJECT_ID }),
    } as unknown as ProjectAttachmentServiceDeps['access'],
    assets: {
      findByIds: async (ids: readonly string[]) => ids.filter((id) => id !== GONE).map(record),
      resolveUrls,
    } as unknown as ProjectAttachmentServiceDeps['assets'],
    assetsLibrary: { getAsset } as unknown as ProjectAttachmentServiceDeps['assetsLibrary'],
    adminUsers: {
      findByIds: async () => [
        { id: ADMIN_ID, firstName: 'Ada', lastName: 'Admin', email: 'ada@example.test' },
      ],
    } as unknown as ProjectAttachmentServiceDeps['adminUsers'],
  } satisfies ProjectAttachmentServiceDeps;
  return { service: new ProjectAttachmentService(deps), resolveUrls, getAsset };
}

describe('ProjectAttachmentService.list — download links (issue #545)', () => {
  it('resolves every link in one batched read and reads no asset detail', async () => {
    const { service, resolveUrls, getAsset } = makeService();

    const attachments = await service.list(PROJECT_ID);

    expect(getAsset).not.toHaveBeenCalled();
    expect(resolveUrls).toHaveBeenCalledTimes(1);
    expect([...(resolveUrls.mock.calls[0]?.[0] ?? [])].sort()).toEqual([...assetIds].sort());
    expect(attachments.map((attachment) => attachment.url)).toEqual([
      ...assetIds.map(
        (id) => `https://api.example.test/api/v1/assets/file/${id}?sig=abc&download=1`,
      ),
      null,
    ]);
  });
});
