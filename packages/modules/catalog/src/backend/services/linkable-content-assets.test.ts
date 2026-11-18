import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { CatalogAttributeView } from './catalog-attribute-read.service.js';
import { CategoryAdminService } from './category-admin.service.js';
import { ProductContentService } from './product-content.service.js';

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — a category's page content
 * is an unrestricted reference: an asset id it stores is listed in the library
 * for every reader. So an id a save newly adds is refused unless the caller may
 * see it — a hidden file and a missing one alike, with the answer the
 * category's main image already gives. An id already stored saves as before.
 */

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

const doc = (...ids: string[]) => ({
  root: { props: {} },
  content: ids.map((assetId) => ({ type: 'cms.Image', props: { assetId } })),
});

function harness() {
  const category = {
    id: CATEGORY_ID,
    content: { languages: { 'pl-PL': doc(STORED) } } as unknown,
  };
  let flushed = 0;
  const em = {
    findOne: async () => category,
    flush: async () => {
      flushed += 1;
    },
  } as unknown as EntityManager;
  const asked: string[][] = [];
  const assets = {
    findById: async () => null,
    visibleToCaller: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Set(ids.filter((id) => id === VISIBLE || id === STORED));
    },
  };
  const service = new CategoryAdminService(() => em, undefined, undefined, undefined, undefined, assets);
  return { service, category, asked, flushes: () => flushed };
}

describe('category content — asset ids a save newly adds (issue #544)', () => {
  it.each([HIDDEN, MISSING])('refuses %s as a missing asset and stores nothing', async (id) => {
    const h = harness();
    const err = await h.service
      .setContent(CATEGORY_ID, { languages: { 'en-US': doc(VISIBLE, id) } } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(404);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect((err as HttpError).details).toEqual({ assetId: id });
    expect((err as HttpError).message).toBe(`Asset ${id} not found.`);
    expect(h.category.content).toEqual({ languages: { 'pl-PL': doc(STORED) } });
  });

  it('saves a visible embed and one the category already stores, asking only about the new one', async () => {
    const h = harness();
    const next = { languages: { 'en-US': doc(VISIBLE, STORED) } };
    await h.service.setContent(CATEGORY_ID, next as never);
    expect(h.category.content).toEqual(next);
    expect(h.asked).toEqual([[VISIBLE]]);
  });

  it('clears the content without asking', async () => {
    const h = harness();
    await h.service.setContent(CATEGORY_ID, null);
    expect(h.category.content).toBeNull();
    expect(h.asked).toEqual([]);
  });
});

describe('product content attributes — asset ids a save newly adds (issue #544)', () => {
  const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
  const SET_ID = '55555555-5555-4555-8555-555555555555';

  function productHarness() {
    let stored: unknown = { languages: { 'pl-PL': doc(STORED) } };
    const em = {
      findOne: async (_entity: unknown, where: Record<string, unknown>) =>
        'productAttributeId' in where ? { content: stored } : { id: PRODUCT_ID, attributeSetId: SET_ID },
      execute: async () => [{ custom_field_definition_id: 'def-guide', position: 0 }],
    } as unknown as EntityManager;
    const attributeRead = {
      listAll: async () =>
        [{ id: 'attr-guide', customFieldDefinitionId: 'def-guide', key: 'guide', label: {}, labelDefault: 'Guide', valueType: 'page_builder' }] as unknown as CatalogAttributeView[],
    };
    const commandBus = {
      run: async (command: { run: (ctx: unknown) => Promise<{ result: unknown }> }) => {
        const outcome = await command.run({ em: { execute: async () => [] } });
        stored = outcome.result;
        return outcome.result;
      },
    } as unknown as CommandBus;
    const asked: string[][] = [];
    const assets = {
      visibleToCaller: async (ids: readonly string[]) => {
        asked.push([...ids]);
        return new Set(ids.filter((id) => id === VISIBLE || id === STORED));
      },
    };
    const service = new ProductContentService(() => em, commandBus, attributeRead, assets);
    return { service, asked, stored: () => stored };
  }

  it.each([HIDDEN, MISSING])('refuses %s as a missing asset and stores nothing', async (id) => {
    const h = productHarness();
    const err = await h.service
      .replace(PRODUCT_ID, 'guide', { languages: { 'en-US': doc(id) } } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect((err as HttpError).details).toEqual({ assetId: id });
    expect((err as HttpError).message).toBe(`Asset ${id} not found.`);
    expect(h.stored()).toEqual({ languages: { 'pl-PL': doc(STORED) } });
  });

  it('saves a visible embed and one the value already stores, asking only about the new one', async () => {
    const h = productHarness();
    await h.service.replace(PRODUCT_ID, 'guide', { languages: { 'en-US': doc(VISIBLE, STORED) } } as never);
    expect(h.asked).toEqual([[VISIBLE]]);
  });
});
