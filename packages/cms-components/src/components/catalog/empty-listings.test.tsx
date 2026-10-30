// @vitest-environment jsdom
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { blockDataKey, blogPostsDataRequest, categorySelectionDataRequest, productSourceDataRequest, type BlockData } from '../../utils/block-data.js';
import { CatalogPreviewProvider } from '../catalog-preview-context.js';
import { CmsRenderProvider } from '../render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// The carousels' editor render reads the previewed page from the editor's store; outside <Puck> it is page 0.
vi.mock('@endora-commerce/page-builder-core/editor/carousel-preview', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEditorCarouselPage: () => 0,
}));

/**
 * `specs/169-page-builder-contact-form/` US2, FR-003–FR-005 (T006) — **an empty
 * listing disappears from the storefront**. A product or category listing that
 * resolves no items renders nothing for shoppers — no box, no heading, no
 * untranslated "No products found" — as `blog.LatestPosts` already did; the
 * editor keeps its explanatory note.
 */

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;

const PRODUCT_PROPS = { source: 'category', categorySlug: 'sensors', limit: 8, header: { heading: 'Featured' } };
const CATEGORY_PROPS = { selectionMode: 'all' };

const cases: { type: string; props: Record<string, unknown>; note: RegExp }[] = [
  { type: 'catalog.ProductSlider', props: PRODUCT_PROPS, note: /No products in this category/ },
  { type: 'catalog.ProductGrid', props: PRODUCT_PROPS, note: /No products in this category/ },
  { type: 'catalog.CategoryGrid', props: CATEGORY_PROPS, note: /No categories to preview/ },
  { type: 'catalog.CategoryList', props: CATEGORY_PROPS, note: /No categories to preview/ },
  { type: 'blog.LatestPosts', props: { limit: 6 }, note: /No posts/ },
];

/** Every listing's request resolved to an empty list, as the storefront's server render hands it. */
const EMPTY: BlockData = {
  [blockDataKey(productSourceDataRequest({ source: 'category', productSlugs: [], categorySlug: 'sensors', searchQuery: '', limit: 8 }))]: [],
  [blockDataKey(categorySelectionDataRequest({ selectionMode: 'all', categorySlugs: [], parentSlug: '', maxDepth: undefined }))]: [],
  [blockDataKey(blogPostsDataRequest({ limit: 6, categorySlug: undefined }))]: [],
};

function providers(children: ReactNode, preview: boolean): string {
  return renderToString(
    <BlockRenderEnvironmentProvider value={{ language: 'en', preview }}>
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
        <CatalogPreviewProvider data={EMPTY}>{children}</CatalogPreviewProvider>
      </CmsRenderProvider>
    </BlockRenderEnvironmentProvider>,
  );
}

function storefront(type: string, props: Record<string, unknown>): string {
  const content = [{ type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } }] as Data['content'];
  return providers(<Render config={config} data={{ root: { props: {} }, content }} />, false);
}

function editor(type: string, props: Record<string, unknown>): string {
  const render = (config.components[type] as ComponentConfig).render as unknown as ComponentType<Record<string, unknown>>;
  return providers(createElement(render, { ...defaultsOf(type), id: `${type}-1`, ...props, puck: { isEditing: true, dragRef: null } }), true);
}

describe('empty listing blocks (T006, FR-003, FR-004)', () => {
  it.each(cases)('$type: the storefront renders nothing — no box, no heading, no sentence', ({ type, props }) => {
    const html = storefront(type, props);
    // Only the page's own wrappers are left (the drop zone and the block's hide-on wrapper), with nothing inside.
    const host = document.createElement('div');
    host.innerHTML = html;
    const wrapper = host.querySelector('.cmsc-pb-hide-on');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.childNodes.length).toBe(0);
    expect(html).not.toContain('cmsc-pb-product-grid__empty');
    expect(html).not.toContain('Featured');
    expect(html).not.toMatch(/No (products|categories) found/);
  });

  it.each(cases)('$type: the editor keeps its note', ({ type, props, note }) => {
    expect(editor(type, props)).toMatch(note);
  });
});
