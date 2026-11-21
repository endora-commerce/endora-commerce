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
 * Feature 174 (T131; US12 #1–#4, FR-100, FR-101, FR-075, `contracts/editor-ui.md` §7) — the
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

// Issue #1510 (CAT-10, DEC-09): the Scope map is a drawer its address opens.
const SCOPES_TAB = `/catalog/products/${PRODUCT_ID}?scope=global&scopeMap=1`;
const drawer = (): HTMLElement => screen.getByRole('dialog', { name: en['productEditor.scope.scopeMap']! });

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

describe('the scope map switches the editor scope (feature 174, US12)', () => {
  it('has no Language row; Global, each channel and each cell are real links', async () => {
    renderEditor(ProductEditor, { url: SCOPES_TAB });
    const table = await map();
    expect(within(table).queryByText('Every channel')).toBeNull();
    expect(within(drawer()).getByRole('link', { name: 'Edit at Global' })).toHaveAttribute('href', expect.stringContaining('scope=global'));
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
    // The jump lands on the editor, so the drawer closes with it.
    expect(currentSearch(view).get('scopeMap')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: en['productEditor.scope.scopeMap']! })).toBeNull());
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
    fireEvent.click(screen.getByRole('button', { name: en['productEditor.scope.scopeMap']! }));
    const link = within(await map()).getByRole('link', { name: 'Edit at Retail PL' });
    fireEvent.click(link);
    expect(await screen.findByRole('dialog', { name: /Save your changes at Global\?/ })).toBeInTheDocument();
  });

  it('a reset keeps working beside the links (FR-101)', async () => {
    renderEditor(ProductEditor, { url: SCOPES_TAB });
    const table = await map();
    fireEvent.click(within(table).getByRole('button', { name: /^Use value from Global for .* in Retail PL$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${BASE}/scopes`, expect.anything()));
  });

  // Owner decision 2026-11-04: one name per place. The tab and the table are the "Scope map", and a
  // reset names the scope the value then comes from: Global for a channel, the channel for a cell.
  it('the drawer and the table are the Scope map; a reset names the scope the value comes from', async () => {
    renderEditor(ProductEditor, { url: SCOPES_TAB });
    const table = await screen.findByRole('table', { name: 'Scope map' });
    expect(screen.getByRole('dialog', { name: 'Scope map' })).toContainElement(table);
    expect(screen.queryByText(/Scope overview|Use inherited/)).toBeNull();
    const channelReset = within(table).getByRole('button', { name: /^Use value from Global for .* in Retail PL$/ });
    expect(channelReset).toHaveTextContent('Use value from Global');
    const cellReset = within(table).getByRole('button', {
      name: `Use value from Retail PL for ${en['productEditor.scopeOverview.field.urlKey']} in Retail PL · pl-PL`,
    });
    expect(cellReset).toHaveTextContent('Use value from Retail PL');
    fireEvent.click(cellReset);
    const dialog = await screen.findByRole('dialog', {
      name: `Use value from Retail PL for ${en['productEditor.scopeOverview.field.urlKey']} in Retail PL · pl-PL?`,
    });
    expect(within(dialog).getByRole('button', { name: 'Use value from Retail PL' })).toBeInTheDocument();
  });
});
