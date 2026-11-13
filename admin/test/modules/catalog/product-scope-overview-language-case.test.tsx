import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { BASE, CH_RETAIL, PRODUCT_ID, api, defaultRead, en, renderEditor, setUpEditorApi } from './product-editor-harness';

/**
 * Issue #501, item 5 (ruling B) — the scope map showed a `de-DE` channel language as
 * `DE-DE`: the component upper-cased it, and `.b2b-tbl thead th` upper-cases every column
 * header. A language tag is shown as stored, in its canonical BCP 47 case, and its header
 * opts out of the header style through a `normal-case` span (the theme's rule on `th`
 * outranks a utility class on the `th` itself).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const OVERVIEW = {
  data: {
    channels: [{ channelId: CH_RETAIL, name: { 'en-US': 'Retail PL' }, isMember: true, languages: ['de-DE', 'en-US'] }],
    languages: ['de-DE', 'en-US'],
    cells: ['de-DE', 'en-US'].map((languageCode) => ({
      channelId: CH_RETAIL,
      languageCode,
      available: true,
      effectiveStatus: 'active',
      statusSource: 'global',
      overriddenFields: languageCode === 'de-DE' ? [{ field: 'urlKey', level: 'channel_language' }] : [],
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

describe('scope map language tags keep their canonical case (issue #501)', () => {
  it('shows de-DE as stored in the column header and in a reset name', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global&tab=scopes` });
    const table = await screen.findByRole('table', { name: en['productEditor.scopeOverview.title']! });
    const header = within(table).getByRole('columnheader', { name: 'de-DE' });
    expect(header.querySelector('span.normal-case')).not.toBeNull();
    expect(within(table).queryByText('DE-DE')).toBeNull();
    expect(
      within(table).getByRole('button', {
        name: `Use value from Retail PL for ${en['productEditor.scopeOverview.field.urlKey']} in Retail PL · de-DE`,
      }),
    ).toBeTruthy();
  });
});
