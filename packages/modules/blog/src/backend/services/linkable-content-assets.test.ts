import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { BlogCategoryService } from './blog-category-service.js';
import { BlogPostService } from './blog-post-service.js';
import { assertLinkableContentAssets } from './linkable-asset.js';

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — a post's content and a
 * category's description are unrestricted references: an asset id they store
 * is listed in the library for every reader. So an id a save newly adds is
 * refused unless the caller may see it — a hidden file and a missing one
 * alike, with the answer the main image already gives. An id already stored
 * saves as before.
 */

const ROW_ID = '11111111-1111-4111-8111-111111111111';
const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

const doc = (...ids: string[]) => ({
  root: { props: {} },
  content: ids.map((assetId) => ({ type: 'cms.Image', props: { assetId } })),
});

function visibility() {
  const asked: string[][] = [];
  return {
    asked,
    findById: async () => null,
    visibleToCaller: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Set(ids.filter((id) => id === VISIBLE || id === STORED));
    },
  };
}

function fakeEm(): { em: EntityManager; writes: string[] } {
  const writes: string[] = [];
  const row = {
    id: ROW_ID,
    slug: 'row',
    status: 'draft',
    version: 3,
    content: { schema_version: 1, languages: { 'pl-PL': doc(STORED) } },
    description: { schema_version: 1, languages: { 'pl-PL': doc(STORED) } },
  };
  const em = {
    execute: async (sql: string) => {
      if (/^\s*update\b/i.test(sql)) writes.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (/select \* from blog_(posts|categories)/.test(sql)) return [row];
      return [];
    },
    transactional: async <T>(cb: (tx: EntityManager) => Promise<T>) => cb(em as unknown as EntityManager),
  };
  return { em: em as unknown as EntityManager, writes };
}

describe('blog — asset ids a save newly adds (issue #544)', () => {
  it.each([HIDDEN, MISSING])('refuses %s in a post’s content as a missing asset, writing nothing', async (id) => {
    const { em, writes } = fakeEm();
    const service = new BlogPostService(() => em, undefined, undefined, visibility());
    const err = await service
      .setContent(ROW_ID, { content: { schema_version: 1, languages: { 'en-US': doc(VISIBLE, id) } }, version: 3 } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(404);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect((err as HttpError).details).toEqual({ assetId: id });
    expect((err as HttpError).message).toBe(`Asset ${id} not found.`);
    expect(writes).toEqual([]);
  });

  it.each([HIDDEN, MISSING])('refuses %s in a category’s description as a missing asset, writing nothing', async (id) => {
    const { em, writes } = fakeEm();
    const service = new BlogCategoryService(() => em, undefined, undefined, visibility());
    const err = await service
      .setDescription(ROW_ID, { description: { schema_version: 1, languages: { 'en-US': doc(id) } }, version: 3 } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect((err as HttpError).details).toEqual({ assetId: id });
    expect(writes).toEqual([]);
  });

  it('accepts a visible id and one already stored, asking only about the new one', async () => {
    const assets = visibility();
    await assertLinkableContentAssets(assets, { languages: { 'en-US': doc(VISIBLE, STORED) } }, { languages: { 'pl-PL': doc(STORED) } });
    expect(assets.asked).toEqual([[VISIBLE]]);
  });

  it('fails closed when an id is added and the read port is not wired, and is silent when none is', async () => {
    await expect(assertLinkableContentAssets(undefined, doc(VISIBLE), null)).rejects.toThrow(/not wired/);
    await expect(assertLinkableContentAssets(undefined, doc(STORED), doc(STORED))).resolves.toBeUndefined();
  });
});
