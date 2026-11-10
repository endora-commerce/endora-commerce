import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CmsAssetEmbedResolution } from '@endora-commerce/contracts';
import { StorefrontResolver, type CmsAssetResolver, type ResolvedChannel } from './storefront-resolver.js';

/**
 * The asset map a hook and a block by code answer with, as a page's does.
 *
 * **One resolver call per answer, whatever the number of blocks** (issue #685):
 * the map costs two keyed reads for the whole tree, and a hook that asked once
 * per block, or once per image, would be the per-embed cascade that kept
 * Postgres saturated coming back through a different door.
 */
const CHANNEL: ResolvedChannel = { id: 'ch-1', code: 'web', defaultLanguage: 'en-US' };
const LOGO = '11111111-1111-4111-8111-111111111111';
const BANNER = '22222222-2222-4222-8222-222222222222';

function image(assetId: string) {
  return { type: 'cms.Image', props: { id: `img-${assetId.slice(0, 4)}`, assetId } };
}

function blockRow(id: string, code: string, ...content: unknown[]) {
  return {
    id,
    code,
    languages: ['en-US'],
    content: { languages: { 'en-US': { root: { props: {} }, content } } },
  };
}

const BLOCKS = [
  blockRow('b-1', 'footer-logo', image(LOGO)),
  blockRow('b-2', 'footer-banner', image(BANNER), image(LOGO)),
];

/** Answers the hook, its channel scope and its attachments; any block code reads the first block. */
function emStub(): EntityManager {
  return {
    execute: async (sql: string) => {
      if (sql.includes('from cms_hooks')) return [{ id: 'h-1', code: 'footer.top', active: true }];
      if (sql.includes('from cms_hook_sales_channels')) return [{ '?column?': 1 }];
      if (sql.includes('from cms_hook_block_attachments')) return BLOCKS;
      if (sql.includes('from cms_blocks')) return [BLOCKS[1]];
      throw new Error(`unexpected query: ${sql}`);
    },
  } as unknown as EntityManager;
}

function resolution(id: string): CmsAssetEmbedResolution {
  return { url: `/assets/file/${id}?v=cv1`, mimeType: 'image/png', filename: `${id}.png`, label: null, visibility: 'public' };
}

function resolverStub() {
  return vi.fn<CmsAssetResolver>(async (ids) => new Map(ids.map((id) => [id, resolution(id)])));
}

describe('StorefrontResolver — the asset map of a hook and of a block by code', () => {
  it('a hook resolves every asset its blocks embed in one call, each id once', async () => {
    const resolver = resolverStub();
    const sut = new StorefrontResolver(emStub);
    sut.setAssetResolver(resolver);

    const hook = await sut.resolveHookByCode({ resolvedChannel: CHANNEL, code: 'footer.top', language: 'en-US' });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect([...resolver.mock.calls[0]![0]].sort()).toEqual([LOGO, BANNER].sort());
    expect(hook?.assets).toEqual({ [LOGO]: resolution(LOGO), [BANNER]: resolution(BANNER) });
  });

  it('a block by code resolves the assets it embeds in one call', async () => {
    const resolver = resolverStub();
    const sut = new StorefrontResolver(emStub);
    sut.setAssetResolver(resolver);

    const block = await sut.resolveBlockByCode({ resolvedChannel: CHANNEL, code: 'footer-banner', language: 'en-US' });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(block?.assets).toEqual({ [BANNER]: resolution(BANNER), [LOGO]: resolution(LOGO) });
  });

  it('asks nothing of the resolver for a hook whose blocks embed no asset', async () => {
    const resolver = resolverStub();
    const em = {
      execute: async (sql: string) => {
        if (sql.includes('from cms_hooks')) return [{ id: 'h-1', code: 'footer.top', active: true }];
        if (sql.includes('from cms_hook_sales_channels')) return [{ '?column?': 1 }];
        return [blockRow('b-3', 'text-only', { type: 'cms.Heading', props: { id: 'h', text: 'Hi' } })];
      },
    } as unknown as EntityManager;
    const sut = new StorefrontResolver(() => em);
    sut.setAssetResolver(resolver);

    const hook = await sut.resolveHookByCode({ resolvedChannel: CHANNEL, code: 'footer.top', language: 'en-US' });

    expect(resolver).not.toHaveBeenCalled();
    expect(hook?.assets).toEqual({});
  });
});
