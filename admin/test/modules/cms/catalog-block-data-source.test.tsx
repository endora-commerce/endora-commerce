import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act, render, waitFor } from '@testing-library/react';
import { Render } from '@puckeditor/core';
import {
  CatalogPreviewProvider,
  defaultPageBuilderConfig,
  type CatalogPreviewApi,
  type CmsProductSummary,
} from '@endora-commerce/cms-components';
import {
  catalogBlockDataKey,
  collectCatalogBlockDataRequests,
} from '@endora-commerce/cms-components/utils/catalog-block-data';

/**
 * Where a catalogue block's data comes from, in a browser.
 *
 * The storefront resolves a page's catalogue blocks on the server and hands
 * the answers to `CatalogPreviewProvider` as `data`; the admin page builder has
 * no server, hands it `api`, and the block fetches from an effect. The
 * storefront's own harness is server-render only, so the two properties that
 * need a DOM are pinned here:
 *
 *   - **the editor preview still works** — skeleton first, then the products
 *     the preview API answered with;
 *   - **a block given data does not fetch** — not on mount, and not after
 *     hydrating HTML a server rendered from the same data, where it must also
 *     never pass through its loading state.
 */

const DRILL: CmsProductSummary = {
  id: 'p1',
  slug: 'cordless-drill',
  name: 'Cordless Drill 18V',
  sku: 'DR-18',
  primaryAssetUrl: null,
  price: null,
  stockLevel: null,
};

const DOCUMENT = {
  root: { props: {} },
  content: [
    { type: 'catalog.ProductGrid', props: { id: 'grid', source: 'manual', productSlugs: ['cordless-drill'] } },
    { type: 'catalog.ProductCard', props: { id: 'card', productSlug: 'cordless-drill' } },
    { type: 'catalog.CategoryList', props: { id: 'categories', selectionMode: 'all' } },
  ],
  zones: {},
};

function tree(): ReactElement {
  return createElement(Render as never, {
    config: defaultPageBuilderConfig as never,
    data: DOCUMENT as never,
  });
}

function previewApi(): CatalogPreviewApi & Record<keyof CatalogPreviewApi, ReturnType<typeof vi.fn>> {
  return {
    fetchProductsBySlugs: vi.fn(async () => [DRILL]),
    fetchProductsList: vi.fn(async () => []),
    fetchCategoryTree: vi.fn(async () => [
      { id: 'c1', name: 'Power Tools', slug: 'power-tools', sortOrder: 0, productCount: 4, children: [] },
    ]),
  };
}

/** What a server would have resolved for {@link DOCUMENT}. */
function resolvedData(): Record<string, unknown[]> {
  const data: Record<string, unknown[]> = {};
  for (const request of collectCatalogBlockDataRequests([DOCUMENT])) {
    data[catalogBlockDataKey(request)] =
      request.kind === 'categories'
        ? [{ slug: 'power-tools', name: 'Power Tools', productCount: 4, depth: 0 }]
        : [DRILL];
  }
  return data;
}

describe('a catalogue block in the editor preview', () => {
  it('shows its skeleton, then what the preview API answered', async () => {
    const api = previewApi();
    const { container } = render(createElement(CatalogPreviewProvider, { api, children: tree() }));

    expect(container.querySelector('[class*="cmsc-pb-skel-"]')).not.toBeNull();
    expect(container.textContent).toContain('Loading product');

    await waitFor(() => expect(container.querySelector('[class*="cmsc-pb-skel-"]')).toBeNull(), {
      timeout: 3000,
    });
    expect(container.textContent).toContain('Cordless Drill 18V');
    expect(container.textContent).toContain('Power Tools');
    expect(container.textContent).not.toContain('Loading product');
    expect(api.fetchProductsBySlugs).toHaveBeenCalledWith(['cordless-drill']);
    expect(api.fetchCategoryTree).toHaveBeenCalled();
  });
});

describe('a catalogue block given resolved data', () => {
  it('renders it at once and asks the network for nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    const { container } = render(
      createElement(CatalogPreviewProvider, { data: resolvedData() as never, children: tree() }),
    );

    expect(container.textContent).toContain('Cordless Drill 18V');
    expect(container.textContent).toContain('Power Tools');
    expect(container.querySelector('[class*="cmsc-pb-skel-"]')).toBeNull();

    // Long enough for an effect's fetch to have started, had there been one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('hydrates server-rendered HTML without a loading state, a mismatch or a fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    const app = (): ReactElement =>
      createElement(CatalogPreviewProvider, { data: resolvedData() as never, children: tree() });

    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = renderToString(app());
    expect(host.textContent).toContain('Cordless Drill 18V');

    const sawLoadingState: boolean[] = [];
    const observer = new MutationObserver(() => {
      sawLoadingState.push(
        host.querySelector('[class*="cmsc-pb-skel-"]') !== null ||
          (host.textContent ?? '').includes('Loading product'),
      );
    });
    observer.observe(host, { childList: true, subtree: true, characterData: true });

    const recoverable: unknown[] = [];
    await act(async () => {
      hydrateRoot(host, app(), { onRecoverableError: (error) => recoverable.push(error) });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    observer.disconnect();

    expect(recoverable).toEqual([]);
    expect(sawLoadingState).not.toContain(true);
    expect(host.textContent).toContain('Cordless Drill 18V');
    expect(host.textContent).toContain('Power Tools');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    host.remove();
  });
});
