import { describe, expect, it, vi } from 'vitest';
import { RawQueryFragment } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AssetsLibraryService, type AssetsLibraryServiceDeps } from './assets-library.service.js';
import { AssetReferenceRegistry } from './reference-registry.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { Asset } from '../entities/asset.entity.js';

/**
 * The library's reader-aware answers that are not the by-id guard
 * (`specs/166-asset-reference-visibility/` R-5, R-9, R-11): the list leaves out
 * what `exclusionFor` names, move-many skips what `hiddenAmong` names, and a
 * permalink conflict does not name a hidden holder. The evaluator is faked —
 * its own rule is `asset-visibility.test.ts`'s.
 */

const VISIBLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const HIDDEN = 'aaaaaaaa-0000-4000-8000-000000000002';

type Where = Record<string, unknown>;

/** The ids an `idNotAmong` clause leaves out, read back from its raw fragment; `null` when `clause` is not one. */
function excludedIds(clause: Where): string[] | null {
  const [key] = Object.keys(clause);
  const fragment = key === undefined ? undefined : RawQueryFragment.getKnownFragment(key, false);
  if (!fragment || !fragment.sql.includes('<> all(?::uuid[])')) return null;
  return String(fragment.params[0]).replace(/[{}]/g, '').split(',');
}

function fakeEm(rows: Array<{ id: string; folderId?: string | null }>) {
  const finds: Array<{ where: Where; options: Record<string, unknown> | undefined }> = [];
  /** The scoping reads, issued through the query builder (ids only, nothing hydrated). */
  const scopes: Array<{ select?: unknown; where?: Where; andWhere?: unknown[]; mapResults?: boolean }> = [];
  const em = {
    finds,
    scopes,
    createQueryBuilder: vi.fn(() => {
      const scope: (typeof scopes)[number] = {};
      scopes.push(scope);
      const qb = {
        select: (fields: unknown) => ((scope.select = fields), qb),
        where: (where: Where) => ((scope.where = where), qb),
        andWhere: (...args: unknown[]) => ((scope.andWhere = args), qb),
        execute: async (_mode: string, mapResults: boolean) => ((scope.mapResults = mapResults), []),
      };
      return qb;
    }),
    find: vi.fn(async (_entity: unknown, where: Where, options?: Record<string, unknown>) => {
      finds.push({ where, options });
      return options?.['fields'] ? rows.map(({ id }) => ({ id })) : rows;
    }),
    fork: () => em,
    flush: vi.fn(async () => undefined),
    execute: vi.fn(async () => [{ id: HIDDEN }]),
    findOne: vi.fn(async () => ({ id: VISIBLE, permalink: null, deletedAt: null })),
  };
  return em;
}

function service(
  em: ReturnType<typeof fakeEm>,
  visibility: Omit<AssetsLibraryServiceDeps['visibility'], 'visibleReferences'> &
    Partial<Pick<AssetsLibraryServiceDeps['visibility'], 'visibleReferences'>>,
  extra: Partial<AssetsLibraryServiceDeps> = {},
): AssetsLibraryService {
  return new AssetsLibraryService({
    emFactory: () => em as unknown as EntityManager,
    adapters: {} as AdapterRegistry,
    referenceRegistry: new AssetReferenceRegistry(),
    visibility: {
      visibleReferences: async () => {
        throw new Error('visibleReferences: not expected in this case');
      },
      ...visibility,
    },
    loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    ...extra,
  });
}

describe('AssetsLibraryService.listAssets — hidden assets are left out in SQL (R-5)', () => {
  it('scopes the candidates by the list’s own clauses, then excludes what the evaluator hides', async () => {
    const em = fakeEm([]);
    const exclusionFor = vi.fn(async (scope: (candidates: readonly string[]) => Promise<readonly string[]>) => {
      expect(await scope([HIDDEN, VISIBLE])).toEqual([]);
      return [HIDDEN];
    });
    await service(em, { exclusionFor, hiddenAmong: async () => new Set() }).listAssets({ folderId: null, q: 'brief' });

    expect(exclusionFor).toHaveBeenCalledTimes(1);
    // The scoping read: the list's own clauses, the candidates as one uuid-array
    // parameter, ids only and nothing hydrated (T049).
    const [scoping] = em.scopes;
    const scoped = (scoping?.where?.['$and'] as Where[]) ?? [];
    expect(scoped).toContainEqual({ folderId: null });
    expect(scoped).toContainEqual({ deletedAt: null });
    expect(scoped.some((c) => '$or' in c)).toBe(true);
    expect(scoping?.select).toBe('a.id');
    expect(scoping?.andWhere).toEqual(['a.id = any(?::uuid[])', [`{${HIDDEN},${VISIBLE}}`]]);
    expect(scoping?.mapResults).toBe(false);
    // The page: the exclusion as one parameter, beside the list's clauses.
    const [listing] = em.finds;
    const clauses = (listing?.where['$and'] as Where[]) ?? [];
    expect(clauses.map(excludedIds).filter((ids) => ids !== null)).toEqual([[HIDDEN]]);
    expect(clauses).toContainEqual({ folderId: null });
  });

  it('runs today’s query unchanged when nothing is hidden', async () => {
    const em = fakeEm([]);
    await service(em, { exclusionFor: async () => [], hiddenAmong: async () => new Set() }).listAssets({ folderId: null });
    expect(em.finds).toHaveLength(1);
    expect(em.scopes).toHaveLength(0);
    expect(em.finds[0]?.where).toEqual({ $and: [{ folderId: null }, { deletedAt: null }] });
  });
});

describe('AssetsLibraryService.moveMany — a hidden id is skipped like a missing one (R-9)', () => {
  it('moves and counts only what the caller may see', async () => {
    const rows = [{ id: VISIBLE, folderId: null }, { id: HIDDEN, folderId: null }];
    const em = fakeEm(rows);
    const hiddenAmong = vi.fn(async () => new Set([HIDDEN]));
    // The audit row's `assetIds` is measured by the integration test.
    const out = await service(em, { exclusionFor: async () => [], hiddenAmong }).moveMany([VISIBLE, HIDDEN, 'aaaaaaaa-0000-4000-8000-00000000dead'], 'f0000000-0000-4000-8000-000000000001');

    expect(out).toEqual({ movedCount: 1 });
    expect(hiddenAmong).toHaveBeenCalledWith([VISIBLE, HIDDEN]);
    expect(rows.find((r) => r.id === HIDDEN)?.folderId).toBeNull();
    expect(rows.find((r) => r.id === VISIBLE)?.folderId).toBe('f0000000-0000-4000-8000-000000000001');
  });
});

describe('AssetsLibraryService.setPermalink — a hidden holder is not named (R-11)', () => {
  const commandBus = {
    run: async ({ run }: { run: (ctx: { em: unknown }) => Promise<{ result: Asset }> }) => (await run({ em: emRef })).result,
  } as unknown as NonNullable<AssetsLibraryServiceDeps['commandBus']>;
  let emRef: ReturnType<typeof fakeEm>;

  it.each([
    { label: 'a hidden holder is answered as null', hidden: new Set([HIDDEN]), expected: null },
    { label: 'a visible holder is named', hidden: new Set<string>(), expected: HIDDEN },
  ])('$label', async ({ hidden, expected }) => {
    emRef = fakeEm([]);
    const svc = service(emRef, { exclusionFor: async () => [], hiddenAmong: async () => hidden }, { commandBus });
    await expect(svc.setPermalink(VISIBLE, { permalink: 'docs/held.pdf' })).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ASSET_PERMALINK_TAKEN,
      details: { permalink: 'docs/held.pdf', assetId: expected },
    });
  });
});

describe('AssetsLibraryService detail — the "used by" list is the caller’s (FR-007, R-8)', () => {
  it('answers the references the evaluator lets the caller see, never the registry’s full list', async () => {
    const row = {
      id: VISIBLE,
      folderId: null,
      filename: 'chair.png',
      label: null,
      mimeType: 'image/png',
      sizeBytes: 1,
      visibility: 'public',
      storageBackend: 'local',
      storageLocator: 'aa/bb/chair.png',
      storageUrl: 'aa/bb/chair.png',
      contentVersion: 'v1',
      createdAt: new Date('2026-10-29T00:00:00Z'),
      updatedAt: new Date('2026-10-29T00:00:00Z'),
      deletedAt: null,
      pendingCleanup: false,
      permalink: null,
      altText: null,
    };
    const em = fakeEm([]);
    em.findOne.mockImplementation(async () => row as never);
    const adapter = { resolveUrl: async () => ({ url: 'https://cdn.test/chair.png', expiresAt: null }) };
    const registry = new AssetReferenceRegistry();
    const everyDescriptor = vi.fn(async () => [
      { kind: 'task_attachment' as const, entityId: 'hidden-task', label: 'Task', assetId: VISIBLE },
    ]);
    registry.register({ ownerModuleId: 'tasks', findReferences: everyDescriptor });
    const visible = [{ kind: 'product_gallery' as const, entityId: 'p1', label: 'Product' }];
    const visibleReferences = vi.fn(async () => visible);

    const detail = await service(
      em,
      { exclusionFor: async () => [], hiddenAmong: async () => new Set(), visibleReferences },
      {
        referenceRegistry: registry,
        adapters: { getForBackend: async () => adapter, localPublicBase: async () => '' } as unknown as AdapterRegistry,
      },
    ).getAsset(VISIBLE);

    expect(visibleReferences).toHaveBeenCalledWith(VISIBLE);
    expect(detail.references).toEqual(visible);
    expect(everyDescriptor).not.toHaveBeenCalled();
  });
});

describe('AssetsLibraryService.softDelete — counts every reference, names the visible ones (FR-008, R-8)', () => {
  it('refuses while any reference exists, and the 409’s count and details are the caller’s visible references', async () => {
    const em = fakeEm([]);
    const registry = new AssetReferenceRegistry();
    const everyDescriptor = vi.fn(async () => [
      { kind: 'product_gallery' as const, entityId: 'p1', label: 'Product', assetId: VISIBLE },
      { kind: 'task_attachment' as const, entityId: 'hidden-task', label: 'Task', assetId: VISIBLE },
    ]);
    registry.register({ ownerModuleId: 'catalog', findReferences: everyDescriptor });
    const visible = [{ kind: 'product_gallery' as const, entityId: 'p1', label: 'Product' }];
    const visibleReferences = vi.fn(async () => visible);

    const refusal = service(
      em,
      { exclusionFor: async () => [], hiddenAmong: async () => new Set(), visibleReferences },
      { referenceRegistry: registry },
    ).softDelete(VISIBLE);

    await expect(refusal).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.ASSET_REFERENCED,
      message: 'Asset is in use by 1 record(s); detach those first.',
      details: [{ path: 'product_gallery', issue: 'Product' }],
    });
    // The in-use decision is the registry's, which counts every reference.
    expect(everyDescriptor).toHaveBeenCalledTimes(1);
    expect(visibleReferences).toHaveBeenCalledWith(VISIBLE);
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('does not ask for the visible references of a file nothing uses', async () => {
    const em = fakeEm([]);
    const visibleReferences = vi.fn(async () => []);
    const out = await service(em, { exclusionFor: async () => [], hiddenAmong: async () => new Set(), visibleReferences }).softDelete(
      VISIBLE,
    );
    expect(out.deletedAt).toBeInstanceOf(Date);
    expect(visibleReferences).not.toHaveBeenCalled();
  });
});
