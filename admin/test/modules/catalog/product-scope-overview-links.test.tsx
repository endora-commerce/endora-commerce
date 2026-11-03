import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  api,
  currentSearch,
  defaultRead,
  en,
  renderEditor,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Feature 170 (T131; US12 #1–#4, FR-100, FR-101, FR-075, `contracts/editor-ui.md` §7) — the
 * scope map switches the editor scope: every cell, every "whole channel" header and the Global
 * corner is a real link "Edit at <scope>"; a field named in a cell links with `&field=` and
 * opens that field; activation goes through the switch guard; the Language row is gone;
 * resets keep working.
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

const SCOPES_TAB = `/catalog/products/${PRODUCT_ID}?scope=global&tab=scopes`;

beforeEach(() => {
  setUpEditorApi({
    read: defaultRead,
    extra: (path) => (path === `${BASE}/scope-overview` ? OVERVIEW : undefined),
  });
  api.patch.mockResolvedValue({ data: null, warnings: [] });
});
afterEach(() => cleanup());

async function map(): Promise<HTMLElement> {
  return screen.findByRole('table', { name: en['productEditor.scopeOverview.title']! });
}

describe('the scope map switches the editor scope (feature 170, US12)', () => {
  it('has no Language row; Global, each channel and each cell are real links', async () => {
    renderEditor(ProductEditor, { url: SCOPES_TAB });
    const table = await map();
    expect(within(table).queryByText('Every channel')).toBeNull();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('link', { name: 'Edit at Global' })).toHaveAttribute('href', expect.stringContaining('scope=global'));
    expect(within(table).getByRole('link', { name: 'Edit at Retail PL' })).toHaveAttribute(
      'href',
      expect.stringMatching(new RegExp(`scope=channel&.*channel=${CH_RETAIL}`)),
    );
    const cell = within(table).getByRole('link', { name: 'Edit at Retail PL × Polish' });
    expect(cell.tagName).toBe('A');
    expect(cell).toHaveAttribute('href', expect.stringContaining('language=pl-PL'));
  });

  it('a cell link switches the editor to that Channel × language', async () => {
    const view = renderEditor(ProductEditor, { url: SCOPES_TAB });
    fireEvent.click(within(await map()).getByRole('link', { name: 'Edit at Retail PL × Polish' }));
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('cl'));
    expect(currentSearch(view).get('language')).toBe('pl-PL');
  });

  it('a field named in a cell opens that field at that scope', async () => {
    const view = renderEditor(ProductEditor, { url: SCOPES_TAB });
    const link = within(await map()).getByRole('link', { name: `${en['productEditor.field.urlKey']} — Edit at Retail PL × Polish` });
    expect(link).toHaveAttribute('href', expect.stringContaining('field=urlKey'));
    fireEvent.click(link);
    await waitFor(() => expect(currentSearch(view).get('scope')).toBe('cl'));
    expect(currentSearch(view).get('tab')).toBe('details');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(en['productEditor.field.urlKey']!)));
  });

  it('with staged changes a map link asks Save / Discard / Stay first', async () => {
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global` });
    fireEvent.change(await screen.findByLabelText(en['productEditor.field.name']!), { target: { value: 'Wiertarka' } });
    fireEvent.click(screen.getByRole('tab', { name: en['productEditor.tab.scopes']! }));
    const link = within(await map()).getByRole('link', { name: 'Edit at Retail PL' });
    fireEvent.click(link);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Save your changes at Global\?/);
  });

  it('a reset keeps working beside the links (FR-101)', async () => {
    renderEditor(ProductEditor, { url: SCOPES_TAB });
    const table = await map();
    fireEvent.click(within(table).getByRole('button', { name: /^Use inherited for .* in Retail PL$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${BASE}/scopes`, expect.anything()));
  });
});
