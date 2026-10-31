import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsBrandTokens, CmsResolvedPage } from '@endora-commerce/contracts';
import { DEFAULT_BRAND_TOKENS } from '@endora-commerce/contracts';

/**
 * Breadcrumbs that follow the page tree
 * (`specs/163-page-builder-marketing-pages/` T082; spec US8, FR-030–FR-031;
 * research R-18).
 *
 * - A CMS page renders Home › its ancestors › itself, in the order the backend
 *   resolved for the request's channel; an ancestor that channel does not serve
 *   (`slug: null`) is text, not a link, and has no JSON-LD `item`.
 * - The trail is absent when the page hides it, and wears the page's scheme.
 * - JSON-LD `item` values are absolute (`siteUrl()`), which a `BreadcrumbList`
 *   requires.
 */

const state: { page: CmsResolvedPage | null; brandTokens: CmsBrandTokens | null } = { page: null, brandTokens: null };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    ctx: { locale: 'en-US', salesChannelCode: 'web' },
    locale: 'en-US',
    brandTokens: state.brandTokens,
  }),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsPageBySlug: async () => state.page,
  normalizeCmsUrlPath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: null }),
}));
vi.mock('../../components/CmsPageRenderer', () => ({
  CmsPageRenderer: () => <div data-testid="page-body" />,
}));
// Feature 163 (T088) renders `OrganizationJsonLd`, an async server component,
// on every CMS page; `renderToString` cannot await it, and this file is about
// the trail. `organization-jsonld.test.tsx` holds that component.
vi.mock('../../components/seo/OrganizationJsonLd', () => ({
  OrganizationJsonLd: () => null,
}));

const { Breadcrumbs } = await import('../../components/Breadcrumbs');
const { default: CmsContentPage } = await import('../../app/(content)/[...slug]/page');

const ORIGIN = 'https://shop.example.com';

function page(breadcrumbs: CmsResolvedPage['breadcrumbs']): CmsResolvedPage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'audience/buyers',
    name: 'Buyers',
    language: 'en-US',
    meta: { title: null, description: null, keywords: null },
    content: { data: { root: { props: {} }, content: [] } },
    embeds: { blocks: {}, templates: {} },
    assets: {},
    breadcrumbs,
    share: { imageUrl: null },
    languages: ['en-US'],
  };
}

function jsonLd(html: string): { itemListElement: Array<{ position: number; name: string; item?: string }> } {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as { itemListElement: Array<{ position: number; name: string; item?: string }> };
}

async function renderPage(): Promise<string> {
  return renderToString(await CmsContentPage({ params: Promise.resolve({ slug: ['audience', 'buyers'] }) }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.page = null;
  state.brandTokens = null;
});

describe('Breadcrumbs', () => {
  it('renders a crumb without a link as text, and gives it no JSON-LD item', () => {
    const html = renderToString(
      <Breadcrumbs locale="en-US"
        crumbs={[
          { href: '/', label: 'Home' },
          { href: null, label: 'Client zone' },
          { href: '/audience/buyers', label: 'Buyers' },
        ]}
      />,
    );
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/<a[^>]*>Client zone<\/a>/);
    expect(html).toContain('Client zone');

    const ld = jsonLd(html);
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Client zone' },
      { '@type': 'ListItem', position: 3, name: 'Buyers', item: `${ORIGIN}/audience/buyers` },
    ]);
  });
});

describe('the CMS page trail', () => {
  it('renders Home › ancestors › page, linking only what the channel serves', async () => {
    state.page = page({
      visible: true,
      scheme: 'light',
      trail: [
        { name: 'Audiences', slug: 'audiences' },
        { name: 'Client zone', slug: null },
      ],
    });
    const html = await renderPage();

    const ld = jsonLd(html);
    expect(ld.itemListElement.map((entry) => [entry.name, entry.item ?? null])).toEqual([
      ['Home', `${ORIGIN}/`],
      ['Audiences', `${ORIGIN}/audiences`],
      ['Client zone', null],
      ['Buyers', `${ORIGIN}/audience/buyers`],
    ]);
    expect(html).toContain('href="/audiences"');
    expect(html).not.toMatch(/<a[^>]*>Client zone<\/a>/);
    expect(html).toMatch(/aria-current="page"[^>]*>Buyers</);
  });

  it('renders no breadcrumbs when the page hides them', async () => {
    state.page = page({ visible: false, scheme: 'light', trail: [{ name: 'Audiences', slug: 'audiences' }] });
    const html = await renderPage();
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('BreadcrumbList');
    expect(html).toContain('data-testid="page-body"');
  });

  it('wears the page scheme on the breadcrumb wrapper', async () => {
    state.page = page({ visible: true, scheme: 'dark', trail: [] });
    const html = await renderPage();
    expect(html).toMatch(/data-cmsb-scheme="dark"[^>]*>[\s\S]*aria-label="Breadcrumb"/);
  });

  it('keeps the light default free of a painted band, as on a page that never set one', async () => {
    state.page = page({ visible: true, scheme: 'light', trail: [] });
    const html = await renderPage();
    expect(html).toContain('data-cmsb-scheme="light"');
    expect(html).not.toContain('bg-[var(--cmsb-bg');
  });

  // R19C (T267): a painted band owns its spacing — padding inside it, no margin spilling out of it.
  it('pads a painted band inside it, so no light strip opens between the band and a dark first section', async () => {
    for (const scheme of ['muted', 'dark'] as const) {
      state.page = page({ visible: true, scheme, trail: [] });
      const html = await renderPage();
      const ol = /<ol class="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(ol, scheme).not.toContain('mb-[16px]');
      expect(ol, scheme).toContain('mb-0');
      expect(html, scheme).toMatch(/<div class="[^"]*\bpb-\[16px\][^"]*"><nav aria-label="Breadcrumb"/);
    }
  });

  it('keeps the light trail\'s own bottom margin, as before', async () => {
    state.page = page({ visible: true, scheme: 'light', trail: [] });
    const html = await renderPage();
    expect(/<ol class="([^"]*)"/.exec(html)?.[1]).toContain('mb-[16px]');
    expect(html).not.toMatch(/<div class="[^"]*\bpb-\[16px\][^"]*"><nav aria-label="Breadcrumb"/);
  });

  // R21H (T355): the trail over the first section — a zero-height layer, so nothing below moves down.
  it('draws the trail over the first section when the page asks, in a zero-height layer with no band', async () => {
    state.page = page({ visible: true, scheme: 'dark', overlay: true, trail: [{ name: 'Audiences', slug: 'audiences' }] });
    const html = await renderPage();
    const layer = /<div ([^>]*data-breadcrumbs-overlay[^>]*)>/.exec(html)?.[1] ?? '';
    expect(layer).toContain('data-cmsb-scheme="dark"');
    expect(layer).toMatch(/class="[^"]*\brelative\b[^"]*\bh-0\b/);
    expect(layer).not.toContain('bg-[var(--cmsb-bg');
    expect(html).toMatch(/<div class="[^"]*\babsolute\b[^"]*\binset-x-0\b[^"]*max-w-\[var\(--cmsb-container,1360px\)\][^"]*"><nav aria-label="Breadcrumb"/);
    // The trail first, then the page body it lies over.
    expect(html.indexOf('aria-label="Breadcrumb"')).toBeLessThan(html.indexOf('data-testid="page-body"'));
    expect(html).toContain('href="/audiences"');
    expect(html).not.toContain('pb-[16px]');
  });

  it('keeps today\'s band when the overlay is off or absent', async () => {
    state.page = page({ visible: true, scheme: 'dark', trail: [] });
    const absent = await renderPage();
    state.page = page({ visible: true, scheme: 'dark', overlay: false, trail: [] });
    expect(await renderPage()).toBe(absent);
    expect(absent).not.toContain('data-breadcrumbs-overlay');
  });

  it('draws nothing over the page when the trail is hidden', async () => {
    state.page = page({ visible: false, scheme: 'dark', overlay: true, trail: [] });
    const html = await renderPage();
    expect(html).not.toContain('data-breadcrumbs-overlay');
    expect(html).not.toContain('aria-label="Breadcrumb"');
  });

  // R19C (T268): the trail sits in the brand's page container, as the page's content does.
  it('holds the trail in the brand container and gutter', async () => {
    state.page = page({ visible: true, scheme: 'light', trail: [] });
    const html = await renderPage();
    expect(html).toContain('max-w-[var(--cmsb-container,1360px)]');
    expect(html).toContain('px-[var(--cmsb-gutter,24px)]');
    expect(html).not.toContain('max-w-[1360px]');
  });
});

/**
 * R22J (T394): on a painted trail (muted and dark schemes, band or over the
 * first section) the links are the scheme's muted text and the current page its
 * text colour — not the link colour; the light trail keeps its own colours.
 * R23 (T432): the brand's band padding (R22J T395) is gone — a stored
 * `layout.breadcrumbsPaddingYPx` is ignored and the band keeps today's padding.
 */
describe('R22J: the painted trail\'s colours; R23: the band\'s own padding only', () => {
  const crumbs = [
    { href: '/', label: 'Home' },
    { href: '/audiences', label: 'Audiences' },
    { href: '/audience/buyers', label: 'Buyers' },
  ];

  it('on muted and dark, links take the muted text and the current page the scheme text', () => {
    for (const scheme of ['muted', 'dark'] as const) {
      const html = renderToString(<Breadcrumbs locale="en-US" crumbs={crumbs} scheme={scheme} />);
      const ol = /<ol class="([^"]*)"/.exec(html)?.[1] ?? '';
      expect(ol, scheme).not.toContain('--cmsb-link');
      expect(ol, scheme).toContain('[&amp;_a]:text-[color:var(--cmsb-fg-muted,#64748b)]');
      expect(html, scheme).toMatch(/<span aria-current="page" class="[^"]*text-\[color:var\(--cmsb-fg,#15202b\)\][^"]*">Buyers<\/span>/);
    }
  });

  it('the light trail keeps its own colours', () => {
    const html = renderToString(<Breadcrumbs locale="en-US" crumbs={crumbs} />);
    expect(html).toContain('<span aria-current="page">Buyers</span>');
    expect(html).not.toContain('--cmsb-fg');
  });

  it('a stored brand band padding (R22J T395, removed by R23) is ignored', async () => {
    state.brandTokens = { ...DEFAULT_BRAND_TOKENS, layout: { ...DEFAULT_BRAND_TOKENS.layout, breadcrumbsPaddingYPx: 7 } } as CmsBrandTokens;
    state.page = page({ visible: true, scheme: 'dark', trail: [] });
    const html = await renderPage();
    expect(html).toMatch(/<div class="[^"]*\bpt-\[24px\] pb-\[16px\] max-md:pt-\[16px\]"><nav aria-label="Breadcrumb"/);
    expect(html).not.toContain('padding-top:7px');
  });

  it('unset, the band keeps today\'s padding', async () => {
    state.brandTokens = DEFAULT_BRAND_TOKENS;
    state.page = page({ visible: true, scheme: 'dark', trail: [] });
    const html = await renderPage();
    expect(html).toMatch(/<div class="[^"]*\bpt-\[24px\] pb-\[16px\] max-md:pt-\[16px\]"><nav aria-label="Breadcrumb"/);
  });
});
