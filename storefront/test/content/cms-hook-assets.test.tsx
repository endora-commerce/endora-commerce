import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import type { CmsResolvedHook } from '@endora-commerce/contracts';
import {
  CmsRenderProvider,
  useCmsRenderAssets,
  useCmsRenderLocation,
  useCmsRenderMediaBaseUrl,
} from '@endora-commerce/cms-components/components/render-context';
import { CmsAssetScope } from '../../components/CmsAssetScope';
import { findElement } from '../components/element-tree';

/**
 * A hook's library images render at their versioned `?v=` URL.
 *
 * The footer and header hooks render in the root layout, outside any page's
 * render context, so a `cms.Image` there found no asset map and built a bare
 * `/assets/file/<id>` — `public, no-cache`, revalidated on every visit — while
 * the same image in a page's content was `immutable` — a footer logo, measured
 * on a deployment. The hook now answers its own map and `Hook` hands it down.
 */

const LOGO = '11111111-1111-4111-8111-111111111111';
const BANNER = '22222222-2222-4222-8222-222222222222';

function asset(id: string, url: string) {
  return { url, mimeType: 'image/png', filename: `${id}.png`, label: null, visibility: 'public' as const };
}

/** Prints what a block below the scope reads from the render context. */
function Probe(): ReactNode {
  const assets = useCmsRenderAssets();
  const media = useCmsRenderMediaBaseUrl();
  const location = useCmsRenderLocation();
  return createElement('pre', null, JSON.stringify({ urls: Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, a.url])), media, path: location?.path ?? null }));
}

function readProbe(html: string): { urls: Record<string, string>; media: string | null; path: string | null } {
  const text = /<pre>(.*)<\/pre>/s.exec(html)![1]!.replace(/&quot;/g, '"');
  return JSON.parse(text);
}

describe('CmsAssetScope', () => {
  it('outside a page, gives the blocks below it the hook’s assets and the API origin', () => {
    const html = renderToString(
      createElement(CmsAssetScope, {
        assets: { [LOGO]: asset(LOGO, 'http://api.test/assets/file/logo?v=1') },
        mediaBaseUrl: 'http://api.test',
        children: createElement(Probe),
      }),
    );
    expect(readProbe(html)).toEqual({
      urls: { [LOGO]: 'http://api.test/assets/file/logo?v=1' },
      media: 'http://api.test',
      path: null,
    });
  });

  it('inside a page, adds the hook’s assets to the page’s and keeps the rest of its context', () => {
    const html = renderToString(
      createElement(CmsRenderProvider, {
        embeds: { blocks: {}, templates: {} },
        assets: { [BANNER]: asset(BANNER, 'http://page.test/banner?v=2') },
        mediaBaseUrl: 'http://page.test',
        location: { path: '/kontakt', query: {} },
        children: createElement(CmsAssetScope, {
          assets: { [LOGO]: asset(LOGO, 'http://api.test/assets/file/logo?v=1') },
          mediaBaseUrl: 'http://api.test',
          children: createElement(Probe),
        }),
      }),
    );
    expect(readProbe(html)).toEqual({
      urls: { [BANNER]: 'http://page.test/banner?v=2', [LOGO]: 'http://api.test/assets/file/logo?v=1' },
      media: 'http://page.test',
      path: '/kontakt',
    });
  });
});

const hook: CmsResolvedHook = {
  hookCode: 'footer.top',
  blocks: [{ id: '33333333-3333-4333-8333-333333333333', code: 'footer-logo', language: 'pl-PL', content: { data: {} } }],
  assets: { [LOGO]: asset(LOGO, `/assets/file/${LOGO}?v=8580ee297fa2`) },
};
const getCmsHookByCode = vi.fn(async (): Promise<CmsResolvedHook | null> => hook);

vi.mock('../../lib/api/cms', () => ({ getCmsHookByCode: () => getCmsHookByCode() }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ ctx: { locale: 'pl-PL' }, modules: undefined }),
}));

describe('Hook', () => {
  it('hands its blocks the hook’s assets, rebased onto the public API origin', async () => {
    const { Hook } = await import('../../components/Hook');
    const tree = await Hook({ code: 'footer.top' });
    const scope = findElement(tree, (el) => el.type === CmsAssetScope);
    expect(scope.props['assets']).toEqual({
      [LOGO]: asset(LOGO, `http://api.test/assets/file/${LOGO}?v=8580ee297fa2`),
    });
    expect(scope.props['mediaBaseUrl']).toBe('http://api.test');
  });

  it('reads an answer cached before the hook carried assets as an empty map', async () => {
    const { assets: _dropped, ...legacy } = hook;
    getCmsHookByCode.mockResolvedValueOnce(legacy);
    const { Hook } = await import('../../components/Hook');
    const tree = await Hook({ code: 'footer.top' });
    expect(findElement(tree, (el) => el.type === CmsAssetScope).props['assets']).toEqual({});
  });
});
