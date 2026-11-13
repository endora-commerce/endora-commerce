import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { BASE, CH_RETAIL, PRODUCT_ID, api, defaultRead, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Issue #501, item 5 — in the scope map the content of a channel row's cells
 * touched the next row's border. `.b2b-tbl tbody td` is `padding: 0 12px`, sized
 * for one-line rows centred in `--row-h`; the map's cells are top-aligned and
 * hold several lines (a field list, reset buttons, links), so they need vertical
 * padding of their own — and so does the row header, which no `.b2b-tbl` rule
 * styles at all.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const OVERVIEW = {
  data: {
    channels: [{ channelId: CH_RETAIL, name: { 'en-US': 'Retail PL' }, isMember: true, languages: ['pl-PL', 'en-US'] }],
    languages: ['pl-PL', 'en-US'],
    cells: ['pl-PL', 'en-US'].map((languageCode) => ({
      channelId: CH_RETAIL,
      languageCode,
      available: true,
      effectiveStatus: 'active',
      statusSource: 'global',
      overriddenFields: languageCode === 'pl-PL' ? [{ field: 'urlKey', level: 'channel_language' }] : [],
      missing: [],
    })),
    channelRows: [{ channelId: CH_RETAIL, overriddenFields: ['minOrderQuantity'] }],
    orphans: [],
  },
};

beforeEach(() => {
  setUpEditorApi({
    read: defaultRead,
    extra: (path) => (path === `${BASE}/scope-overview` ? OVERVIEW : undefined),
  });
  api.patch.mockResolvedValue({ data: null, warnings: [] });
});
afterEach(() => cleanup());

const hasVerticalPadding = (cell: HTMLElement): boolean => {
  const top = Number.parseFloat(cell.style.paddingTop || '0');
  const bottom = Number.parseFloat(cell.style.paddingBottom || '0');
  return top > 0 && bottom > 0;
};

describe('scope map cells keep their content inside the row (issue #501)', () => {
  it('pads every body cell and row header vertically', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global&tab=scopes` });
    const table = await screen.findByRole('table', { name: en['productEditor.scopeOverview.title']! });
    const body = table.querySelector('tbody') as HTMLElement;
    const cells = [...within(body).getAllByRole('rowheader'), ...within(body).getAllByRole('cell')];
    // One row header, the whole-channel cell and the two language cells.
    expect(cells).toHaveLength(4);
    for (const cell of cells) expect(hasVerticalPadding(cell)).toBe(true);
  });
});
