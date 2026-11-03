import { describe, expect, it, vi } from 'vitest';
import { RawQueryFragment } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { FoldersService } from './folders.service.js';
import { AssetReferenceRegistry } from './reference-registry.js';
import { AssetFolder } from '../entities/asset-folder.entity.js';
import { Asset } from '../entities/asset.entity.js';

/**
 * The folder answers that follow the reader
 * (`specs/166-asset-reference-visibility/` R-10, `contracts/admin-api.md` §1.1).
 * The `cancel` refusal's counts are in `details` and both bundle sentences name
 * them (issue #86); they are measured here, on the message and on `details`; the outcomes —
 * what is deleted, moved and audited — are measured by
 * `backend/test/integration/assets_library/folder-delete-references.test.ts`.
 * The evaluator is faked: its own rule is `asset-visibility.test.ts`'s.
 */

const FOLDER = 'f0000000-0000-4000-8000-000000000001';
const VISIBLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const HIDDEN_1 = 'aaaaaaaa-0000-4000-8000-000000000002';
const HIDDEN_2 = 'aaaaaaaa-0000-4000-8000-000000000003';

type Row = { id: string; folderId: string | null; deletedAt: Date | null };

function fakeEm(assets: Row[]) {
  const folder = { id: FOLDER, name: 'Contracts', parentId: null };
  const em = {
    findOne: vi.fn(async (entity: unknown) => (entity === AssetFolder ? folder : null)),
    findOneOrFail: vi.fn(async (_entity: unknown, where: { id: string }) => assets.find((a) => a.id === where.id)),
    find: vi.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === AssetFolder) return [];
      if (entity === Asset) {
        const live = 'deletedAt' in where;
        return assets.filter((a) => !live || a.deletedAt === null);
      }
      return [];
    }),
    count: vi.fn(async () => 0),
    remove: vi.fn(),
    flush: vi.fn(async () => undefined),
    fork: () => em,
  };
  return em;
}

function folders(em: ReturnType<typeof fakeEm>, hidden: readonly string[], registry = new AssetReferenceRegistry()) {
  return new FoldersService(() => em as unknown as EntityManager, registry, {
    hiddenAmong: async (ids) => new Set(ids.filter((id) => hidden.includes(id))),
    exclusionFor: async () => [...hidden],
  });
}

const row = (id: string): Row => ({ id, folderId: FOLDER, deletedAt: null });

describe('FoldersService.deleteFolder — counts follow the reader (R-10)', () => {
  it('cancel: the refusal counts the visible assets only', async () => {
    const em = fakeEm([row(VISIBLE), row(HIDDEN_1), row(HIDDEN_2)]);
    await expect(folders(em, [HIDDEN_1, HIDDEN_2]).deleteFolder(FOLDER, 'cancel')).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ASSET_FOLDER_NOT_EMPTY,
      message: 'Folder is not empty (0 sub-folder(s), 1 asset(s)).',
      // Issue #86 — the counts the bundle sentences name, visible-only too.
      details: { subfolderCount: 0, assetCount: 1 },
    });
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('cancel: an unrestricted reader, who is hidden nothing, is counted every asset as today', async () => {
    const em = fakeEm([row(VISIBLE), row(HIDDEN_1), row(HIDDEN_2)]);
    await expect(folders(em, []).deleteFolder(FOLDER, 'cancel')).rejects.toMatchObject({
      message: 'Folder is not empty (0 sub-folder(s), 3 asset(s)).',
      details: { subfolderCount: 0, assetCount: 3 },
    });
  });

  it('cancel: a folder holding only hidden assets is deleted, its assets moved to the parent', async () => {
    const assets = [row(HIDDEN_1), row(HIDDEN_2)];
    const em = fakeEm(assets);
    await expect(folders(em, [HIDDEN_1, HIDDEN_2]).deleteFolder(FOLDER, 'cancel')).resolves.toEqual({
      deletedFolderId: FOLDER,
    });
    expect(assets.map((a) => a.folderId)).toEqual([null, null]);
    expect(em.remove).toHaveBeenCalledTimes(1);
    expect(em.flush).toHaveBeenCalledTimes(1);
  });

  it('deleteRecursively: the refusal counts and names the visible referenced assets only', async () => {
    const registry = new AssetReferenceRegistry();
    registry.register({
      ownerModuleId: 'catalog',
      findReferences: async (ids) =>
        ids
          .filter((id) => id === VISIBLE || id === HIDDEN_1)
          .map((id) => ({ kind: 'product_gallery' as const, entityId: 'p1', label: 'Product', assetId: id })),
    });
    const em = fakeEm([row(VISIBLE), row(HIDDEN_1)]);
    await expect(folders(em, [HIDDEN_1], registry).deleteFolder(FOLDER, 'deleteRecursively')).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ASSET_REFERENCED,
      message: 'Cannot delete folder: 1 asset(s) in this subtree are still referenced.',
      details: [{ path: 'assetId', issue: VISIBLE }],
    });
    expect(em.flush).not.toHaveBeenCalled();
  });
});

describe('FoldersService.countPermalinkedAssets — the reader’s files only (R-10)', () => {
  it('leaves out what the evaluator excludes', async () => {
    const em = fakeEm([]);
    await folders(em, [HIDDEN_1]).countPermalinkedAssets(FOLDER);
    const [, where] = em.count.mock.calls[0] as unknown as [unknown, { $and: Array<Record<string, unknown>> }];
    const [own, exclusion] = where.$and;
    expect(own).toMatchObject({ deletedAt: null, permalink: { $ne: null } });
    // The exclusion travels as one uuid-array parameter (T049).
    const fragment = RawQueryFragment.getKnownFragment(Object.keys(exclusion ?? {})[0] ?? '', false);
    expect(fragment?.sql).toContain('<> all(?::uuid[])');
    expect(fragment?.params).toEqual([`{${HIDDEN_1}}`]);
  });

  it('runs today’s count unchanged when nothing is hidden', async () => {
    const em = fakeEm([]);
    await folders(em, []).countPermalinkedAssets(FOLDER);
    const [, where] = em.count.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(where).not.toHaveProperty('id');
  });
});
