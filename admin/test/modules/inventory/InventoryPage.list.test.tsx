import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import {
  productInventoryHref,
  stockDisplayBandLabels,
  stockDisplayBandTone,
} from '../../../../packages/modules/inventory/src/admin/lib/labels';

/**
 * Issue #1460 (CAT-15) — the inventory list printed the raw display band
 * (`out_of_stock`), sent "Edit stock" to the product's Details tab, and had a
 * search input whose only name was its placeholder.
 *
 * The band cell reads `{r.displayBand}`, a property name the raw-enum lint rule
 * does not recognise, so this file — not lint — is what holds it translated.
 */
const read = (language: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
const echo = (key: string): string => key;
const BANDS = ['high', 'medium', 'low', 'out_of_stock', 'available'] as const;

describe('stock display band labels', () => {
  it.each(['en', 'pl'])('resolves every band in %s', (language) => {
    const bundle = read(language);
    for (const band of BANDS) {
      expect(stockDisplayBandLabels.has(band), band).toBe(true);
      expect(bundle[stockDisplayBandLabels.label(echo, band)], band).toBeTruthy();
    }
  });

  it('declares exactly the bands the contract sends', () => {
    expect([...stockDisplayBandLabels.values].sort()).toEqual([...BANDS].sort());
  });

  it('gives low and medium different tones, so colour does not merge them', () => {
    expect(stockDisplayBandTone('low')).not.toBe(stockDisplayBandTone('medium'));
    expect(stockDisplayBandTone('low')).toContain('b2b-badge--danger');
    expect(stockDisplayBandTone('out_of_stock')).not.toBe(stockDisplayBandTone('low'));
  });
});

describe('the edit-stock deep link', () => {
  it('lands on the product editor’s Inventory tab', () => {
    expect(productInventoryHref('p-1')).toBe('/catalog/products/p-1?tab=inventory');
  });
});

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000f1';
const roster = {
  items: BANDS.map((band, i) => ({
    productId: i === 0 ? PRODUCT_ID : `00000000-0000-4000-8000-00000000000${i}`,
    productSku: `SKU-${band}`,
    productName: `Product ${band}`,
    cumulativeOnHand: 5,
    displayBand: band,
    lowStockThreshold: 1,
    perWarehouse: [],
  })),
  page: 0,
  pageSize: 25,
  total: BANDS.length,
};
const kpis = {
  data: { totalProductsTracked: 5, totalOnHand: 25, outOfStockCount: 1, lowStockCount: 1, perWarehouseTotals: [] },
};
const get = vi.fn(async (url: string) => (url.includes('/levels') ? roster : kpis));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => get(...(args as [string])),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

async function mount(): Promise<Record<string, string>> {
  const en = read('en');
  const { InventoryPage } = await import('../../../../packages/modules/inventory/src/admin/pages/InventoryPage');
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/inventory']}>
        <InventoryPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['inventory:read'] }),
        presence: modulePresence({ present: ['inventory'] }),
      },
    ),
    { core: en },
  );
  await waitFor(() => expect(screen.getByText('SKU-high')).toBeInTheDocument());
  return en;
}

describe('the inventory list', () => {
  it('shows every band translated, never the raw value', async () => {
    const en = await mount();
    const table = screen.getByRole('table');
    for (const band of BANDS) {
      const row = within(table).getByText(`Product ${band}`).closest('tr') as HTMLElement;
      expect(within(row).getByText(en[`inventory.band.${band}`] as string)).toBeInTheDocument();
      expect(within(row).queryByText(band)).not.toBeInTheDocument();
    }
  });

  it('links each row’s Edit stock to the Inventory tab', async () => {
    const en = await mount();
    const row = screen.getByText('Product high').closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', { name: en['inventory.action.editStock'] as string });
    expect(link.getAttribute('href')).toBe(`/catalog/products/${PRODUCT_ID}?tab=inventory`);
  });

  it('names the search input programmatically, not by its placeholder alone', async () => {
    const en = await mount();
    expect(screen.getByRole('searchbox', { name: en['inventory.search.label'] as string })).toBeInTheDocument();
  });

  it('exposes the filter chips’ state with aria-pressed', async () => {
    const en = await mount();
    const low = screen.getByRole('button', { name: en['inventory.stat.lowStock'] as string });
    expect(low.getAttribute('aria-pressed')).toBe('false');
    low.click();
    await waitFor(() => expect(low.getAttribute('aria-pressed')).toBe('true'));
  });
});
