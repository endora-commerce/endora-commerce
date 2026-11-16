import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CmsBlockService } from './cms-block-service.js';
import { CmsPageService } from './cms-page-service.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import { CmsTemplateService } from './cms-template-service.js';

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — a page, block or template
 * body, and a page's sharing image, are unrestricted references: an asset id
 * they store is listed in the library for every reader. So an id a save newly
 * adds is refused unless the caller may see it in the library — a hidden file
 * and a missing one alike. An id the record already stores is its own
 * reference and saves as before.
 */

const ROW_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

const WRITE_STATEMENT = /^\s*(insert|update|delete)\b/i;

function row(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROW_ID,
    name: 'Row',
    slug: 'row',
    code: 'row',
    status: 'draft',
    active: true,
    description: null,
    meta_title: null,
    meta_description: null,
    meta_keywords: null,
    // STORED is already embedded — in another language than the one saved.
    content: { languages: { 'pl-PL': { content: [{ type: 'cms.Image', props: { assetId: STORED } }] } } },
    languages: ['en-US', 'pl-PL'],
    version: 3,
    share_image_asset_id: STORED,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  };
}

function fakeEm(writes: string[]): EntityManager {
  return {
    execute: async (sql: string): Promise<unknown[]> => {
      if (WRITE_STATEMENT.test(sql)) {
        writes.push(sql.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
        return [];
      }
      if (/^\s*select \* from cms_(pages|blocks|templates)/i.test(sql)) return [row()];
      if (/sales_channel_id::text as id/.test(sql)) return [{ id: CHANNEL_ID }];
      if (/^\s*select slug from/i.test(sql)) return [{ slug: 'row' }];
      return [];
    },
    find: async (): Promise<unknown[]> => [{ languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' }],
  } as unknown as EntityManager;
}

function harness() {
  const writes: string[] = [];
  const em = fakeEm(writes);
  const commandBus = {
    run: async <T>(command: Command<T>): Promise<T> =>
      (
        await command.run({
          em,
          actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
        })
      ).result,
  } as unknown as CommandBus;
  const asked: string[][] = [];
  const assets = {
    visibleToCaller: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Set(ids.filter((id) => id === VISIBLE || id === STORED));
    },
  };
  const references = { findBlockReferences: async () => [], findTemplateReferences: async () => [] } as unknown as CmsReferenceRegistry;
  return {
    writes,
    asked,
    pages: new CmsPageService(() => em, commandBus, () => [], undefined, undefined, assets),
    blocks: new CmsBlockService(() => em, commandBus, () => [], references, undefined, assets),
    templates: new CmsTemplateService(() => em, commandBus, () => [], references, undefined, assets),
  };
}

const tree = (...ids: string[]) => ({
  root: { props: {} },
  content: ids.map((assetId) => ({ type: 'cms.Image', props: { assetId } })),
});

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe('cms — asset ids a save newly adds must be visible to the caller (issue #544)', () => {
  it.each(['pages', 'blocks', 'templates'] as const)('%s: refuses a hidden and a missing embed alike, writing nothing', async (kind) => {
    for (const id of [HIDDEN, MISSING]) {
      const h = harness();
      const err = await refusal(h[kind].setContent(ROW_ID, 'en-US', tree(VISIBLE, id), 3));
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
      expect(err.message).toBe(`Asset ${id} not found.`);
      expect(h.writes).toEqual([]);
    }
  });

  it.each(['pages', 'blocks', 'templates'] as const)('%s: saves a visible embed, and one the record already stores without asking', async (kind) => {
    const h = harness();
    await h[kind].setContent(ROW_ID, 'en-US', tree(VISIBLE, STORED), 3);
    expect(h.writes.length).toBeGreaterThan(0);
    expect(h.asked).toEqual([[VISIBLE]]);
  });

  it('refuses a hidden sharing image on create', async () => {
    const h = harness();
    const err = await refusal(
      h.pages.create({
        name: 'About',
        slug: 'about',
        active: true,
        salesChannelIds: [CHANNEL_ID],
        languages: ['en-US'],
        shareImageAssetId: HIDDEN,
      }),
    );
    expect(err.code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect(h.writes).toEqual([]);
  });

  it('refuses a hidden sharing image on update, and keeps the one already set', async () => {
    const refused = harness();
    const err = await refusal(refused.pages.patch(ROW_ID, { shareImageAssetId: MISSING, version: 3 }));
    expect(err.code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
    expect(refused.writes).toEqual([]);

    const kept = harness();
    await kept.pages.patch(ROW_ID, { shareImageAssetId: STORED, version: 3 });
    expect(kept.asked).toEqual([]);
    const cleared = harness();
    await cleared.pages.patch(ROW_ID, { shareImageAssetId: null, version: 3 });
    expect(cleared.writes).toContain('update cms_pages set');
  });
});
