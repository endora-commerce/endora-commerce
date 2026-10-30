// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import type { CmsBlogPostCard } from '../../schema/blog-types.js';
import type { CmsProductSummary } from '../../schema/catalog-types.js';
import { blockDataKey, blogPostsDataRequest, productSourceDataRequest } from '../../utils/block-data.js';
import { CatalogPreviewProvider } from '../catalog-preview-context.js';
import { CmsRenderProvider } from '../render-context.js';

/**
 * `specs/169-page-builder-contact-form/` US1, FR-001, FR-002 (T002, T003, T005) —
 * **arrows kept when every slide fits**.
 *
 * With `controls.arrowsWhenFit` on and a track that holds every slide
 * (`scrollWidth === clientWidth`), every carousel block keeps both arrows in
 * the published DOM, disabled (there is nowhere to go), with no `[hidden]`
 * ancestor, and the shell marks its root `cmsc-pb-carousel--arrows-kept` so
 * the stylesheet can draw them legibly: the generic disabled look (40 %
 * opacity of an already light ring) left them near-invisible on a light or
 * muted section and over a slide. The option off leaves no such class.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const SHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

const productRequest = productSourceDataRequest({ source: 'category', productSlugs: [], categorySlug: 'sensors', searchQuery: '', limit: 8 });
const products: CmsProductSummary[] = Array.from({ length: 2 }, (_, index) => ({
  id: `product-${index}`,
  slug: `product-${index}`,
  name: `Product ${index}`,
  sku: `SKU-${index}`,
  primaryAssetUrl: null,
  price: { amount: 1000 + index, currency: 'EUR' },
  stockLevel: 3,
  summary: `Summary ${index}`,
}));
const postsRequest = blogPostsDataRequest({ limit: 6, categorySlug: undefined });
const posts: CmsBlogPostCard[] = ['a', 'b'].map((slug) => ({
  id: `id-${slug}`,
  slug,
  name: `Post ${slug}`,
  publishedAt: '2026-04-01T00:00:00.000Z',
  excerpt: null,
  mainImageUrl: `https://cdn.example.com/${slug}.jpg`,
  primaryCategorySlug: 'news',
  primaryCategoryName: 'News',
  url: `/blog/${slug}`,
}));

const split = (id: string, title: string) => ({
  type: 'cms.CarouselSplit',
  props: { id, title: doc(title), body: doc('Text'), media: { kind: 'image', image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' } }, buttons: [] },
});

type Case = { name: string; type: string; props: Record<string, unknown> };

const keep = (arrowsWhenFit: boolean) => ({ arrows: true, dots: true, ...(arrowsWhenFit ? { arrowsWhenFit: true } : {}) });

const cases = (arrowsWhenFit: boolean): Case[] => [
  { name: 'cms.ContentSlider', type: 'cms.ContentSlider', props: { controls: keep(arrowsWhenFit), controlsPlacement: 'below', loop: false } },
  { name: 'cms.ContentSlider (overlay)', type: 'cms.ContentSlider', props: { controls: keep(arrowsWhenFit), controlsPlacement: 'overlay' } },
  {
    name: 'catalog.ProductSlider',
    type: 'catalog.ProductSlider',
    props: { source: 'category', categorySlug: 'sensors', limit: 8, controls: keep(arrowsWhenFit) },
  },
  { name: 'blog.LatestPosts', type: 'blog.LatestPosts', props: { layout: 'carousel', limit: 6, controls: keep(arrowsWhenFit) } },
  {
    name: 'cms.ContentSlider holding cms.CarouselSplit slides (controls in the slide)',
    type: 'cms.ContentSlider',
    props: { slidesPerView: 1, controlsPlacement: 'slide', controls: keep(arrowsWhenFit), slides: [split('a', 'First'), split('b', 'Second')] },
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

/** Mounts the block on the client: jsdom lays nothing out, so `scrollWidth === clientWidth` (0) and every slide fits. */
function mount({ type, props }: Case): HTMLElement {
  const content = [{ type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } }] as Data['content'];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
        <CatalogPreviewProvider data={{ [blockDataKey(productRequest)]: products, [blockDataKey(postsRequest)]: posts }}>
          <Render config={config} data={{ root: { props: {} }, content }} />
        </CatalogPreviewProvider>
      </CmsRenderProvider>,
    ),
  );
  return host;
}

/**
 * The arrows a shopper can see: not inside a `[hidden]` group, nor in an inert copy of another
 * slide, nor in the row under the track the stylesheet removes once a slide draws the controls.
 */
function shownArrows(element: HTMLElement): HTMLButtonElement[] {
  const slideDrawsControls = element.querySelector('.cmsc-pb-carousel__viewport .cmsc-pb-carousel__controls--slide') !== null;
  expect(SHEET).toContain(
    '.cmsc-pb-carousel:has(> .cmsc-pb-carousel__viewport .cmsc-pb-carousel__controls--slide) > .cmsc-pb-carousel__controls--slide-fallback { display: none; }',
  );
  return Array.from(element.querySelectorAll<HTMLButtonElement>('.cmsc-pb-carousel__arrow')).filter(
    (arrow) =>
      arrow.closest('[hidden]') === null &&
      arrow.closest('[inert]') === null &&
      !(slideDrawsControls && arrow.closest('.cmsc-pb-carousel__controls--slide-fallback') !== null),
  );
}

describe('arrows kept when every slide fits (T002, FR-001)', () => {
  it.each(cases(true))('$name: both arrows present, disabled, not hidden; the root says they are kept', (testCase) => {
    const element = mount(testCase);
    const carousel = element.querySelector<HTMLElement>('.cmsc-pb-carousel')!;
    expect(carousel).not.toBeNull();
    const arrows = shownArrows(element);
    expect(arrows.map((arrow) => arrow.classList.contains('cmsc-pb-carousel__arrow--prev') ? 'prev' : 'next').sort()).toEqual(['next', 'prev']);
    for (const arrow of arrows) expect(arrow.disabled).toBe(true);
    expect(carousel.classList.contains('cmsc-pb-carousel--arrows-kept')).toBe(true);
  });

  it.each(cases(false))('$name, option off: the controls hide as today and no kept class is written (FR-002)', (testCase) => {
    const element = mount(testCase);
    const carousel = element.querySelector<HTMLElement>('.cmsc-pb-carousel')!;
    expect(carousel.className).not.toContain('--arrows-kept');
    expect(shownArrows(element)).toEqual([]);
  });
});

describe('the kept arrows’ look (T003, T005)', () => {
  it('a kept, disabled arrow is drawn at full opacity in the scheme’s border and muted text, literal fallbacks', () => {
    const rule = /\.cmsc-pb-carousel--arrows-kept \.cmsc-pb-carousel__arrow:disabled \{([^}]*)\}/.exec(SHEET)?.[1] ?? '';
    expect(rule).toContain('opacity: 1;');
    expect(rule).toContain('border-color: var(--cmsb-border, #d9e0e7);');
    expect(rule).toContain('color: var(--cmsb-fg-muted, #64748b);');
    expect(rule).toContain('cursor: default;');
  });

  it('comes after the generic dimmed rule, and an explicit disabled look still wins (selector order)', () => {
    const dim = SHEET.indexOf('.cmsc-pb-carousel__arrow:disabled { opacity: 0.4;');
    const kept = SHEET.indexOf('.cmsc-pb-carousel--arrows-kept .cmsc-pb-carousel__arrow:disabled {');
    const light = SHEET.indexOf('.cmsc-pb-carousel--arrow-off-light .cmsc-pb-carousel__arrow:disabled,');
    expect(dim).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(dim);
    expect(light).toBeGreaterThan(kept);
  });

  it('inside a dark scheme the kept arrow reads the scheme’s tokens: no white disc left behind', () => {
    const rule = /\.cmsc-pb-carousel--arrows-kept \.cmsc-pb-carousel__arrow:disabled \{([^}]*)\}/.exec(SHEET)?.[1] ?? '';
    // The base arrow's literal `#fff` disc is replaced by the scheme's own background.
    expect(rule).toContain('background: var(--cmsb-bg, #fff);');
    // The dark scheme binds those tokens to light-on-dark values.
    expect(SHEET).toMatch(/\[data-cmsb-scheme='dark'\] \{ --cmsb-bg: #0f172a; --cmsb-fg: #f8fafc; --cmsb-fg-muted: #cbd5e1; --cmsb-border: #334155;/);
  });
});
