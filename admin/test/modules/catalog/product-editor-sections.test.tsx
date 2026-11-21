import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  IMMEDIATE_BADGE,
  PRODUCT_ID,
  VALID_SCOPES,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Issue #1488 (UX audit 2026-11-17, CAT-06) — the product editor is one card per tab, and what a
 * tab groups is a set of kit `EditorSection`s inside it, not a card inside the card (Common
 * Region, Prägnanz). Every structural tab is held to the same layout language as Details, Media,
 * Attachments and SEO (Law of Similarity): no `Card` and no `.b2b-card` inside the tab panel, the
 * sections are `h2` regions, and a list of items is divided rows, not a bordered box per item.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const WH_A = '00000000-0000-4000-8000-0000000000a1';
const WH_B = '00000000-0000-4000-8000-0000000000b2';
const IMG = '00000000-0000-4000-8000-0000000000c1';
const ATT = '00000000-0000-4000-8000-0000000000d1';
const CHILD = '00000000-0000-4000-8000-0000000000e1';

type ProductType = 'simple' | 'configurable' | 'grouped' | 'bundle';

function read(type: ProductType) {
  return (scope: ScopeRef) =>
    scopedValuesResponse({
      scope,
      validScopes: VALID_SCOPES,
      product: { ...scopedValuesResponse().data.product, type },
      gallery: {
        items: [{ id: IMG, assetId: IMG, url: 'https://cdn.example.com/front.jpg', position: 0, altText: scopedField<string>('Front'), hidden: scopedField(false), assetAltText: null }],
        roles: { baseImage: scopedField<string>(IMG), smallImage: scopedField<string>(null), thumbnail: scopedField<string>(null) },
      },
      attachments: [
        { id: ATT, assetId: ATT, typeId: ATT, position: 0, fileName: 'manual.pdf', name: scopedField('Manual'), description: scopedField<string>(null), hidden: scopedField(false) },
      ],
    });
}

function setUp(type: ProductType): void {
  setUpEditorApi({
    read: read(type),
    extra: (path) => {
      if (path === `${BASE}/variants`) return { data: [] };
      if (path === '/api/v1/admin/catalog/attributes/by-flag?flag=isVariantAxis') return { data: { items: [] } };
      if (path === `${BASE}/links`) return { data: [] };
      if (path === `${BASE}/grouped-items`) {
        return { data: [{ id: 'g1', parentProductId: PRODUCT_ID, childProductId: CHILD, quantity: 1, position: 0 }] };
      }
      if (path === `${BASE}/bundle-slots`) {
        return {
          data: [
            { id: 's1', parentProductId: PRODUCT_ID, name: { 'en-US': 'Battery' }, minQuantity: 0, maxQuantity: 1, position: 0, options: [] },
            { id: 's2', parentProductId: PRODUCT_ID, name: { 'en-US': 'Charger' }, minQuantity: 1, maxQuantity: 1, position: 1, options: [] },
          ],
        };
      }
      if (path.startsWith('/api/v1/admin/warehouses')) {
        return {
          items: [
            { id: WH_A, code: 'WA', name: 'Warsaw', isDefault: true },
            { id: WH_B, code: 'WB', name: 'Berlin', isDefault: false },
          ],
        };
      }
      if (path.startsWith('/api/v1/admin/inventory/levels')) {
        return {
          items: [
            {
              productId: PRODUCT_ID,
              perWarehouse: [
                { warehouseId: WH_A, onHand: 1200, lowStockThreshold: null },
                { warehouseId: WH_B, onHand: 40, lowStockThreshold: null },
              ],
            },
          ],
        };
      }
      if (path === '/api/v1/admin/settings/inventory.allow_negative_stock') {
        return { code: 'inventory.allow_negative_stock', globalValue: true, defaultValue: false };
      }
      return undefined;
    },
  });
}

afterEach(() => cleanup());

const at = (tab: string): string => `/catalog/products/${PRODUCT_ID}?scope=global&tab=${tab}`;

/** The tab panel, once the section named `title` has rendered in it. */
async function panelWith(title: string): Promise<HTMLElement> {
  await screen.findByRole('heading', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  return screen.getByRole('tabpanel');
}

/** Every frame inside the panel that is a card: the kit's `Card` or the legacy `.b2b-card`. */
const cards = (panel: HTMLElement): Element[] => [...panel.querySelectorAll('[data-slot=card], .b2b-card')];

/** The tab's own sections: kit `EditorSection`s that are not nested in another one. */
const topSections = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>('section[data-slot=editor-section]')].filter(
    (s) => s.parentElement?.closest('section[data-slot=editor-section]') === null,
  );

function expectSectionsOnly(panel: HTMLElement, titles: readonly string[]): void {
  expect(cards(panel)).toEqual([]);
  const sections = topSections(panel);
  const headings = sections.map((s) => s.querySelector('h2, h3, h4'));
  // One heading style at one level: every section of the tab is an `h2`.
  expect(headings.map((h) => h?.tagName)).toEqual(titles.map(() => 'H2'));
  for (const [i, title] of titles.entries()) expect(headings[i]).toHaveTextContent(title);
  // A section is a region labelled by its heading.
  for (const section of sections) expect(section).toHaveAccessibleName();
}

describe('product editor tabs are sections, not cards in the card (issue #1488, CAT-06)', () => {
  it('Variants', async () => {
    setUp('configurable');
    renderEditor(ProductEditor, { url: at('variants') });
    const panel = await panelWith(en['productEditor.variants.title']!);
    await waitFor(() => expect(within(panel).queryByText(en['productEditor.loading']!)).toBeNull());
    expectSectionsOnly(panel, [en['productEditor.variants.title']!]);
    expect(topSections(panel)[0]!.querySelector('h2')).toHaveTextContent(IMMEDIATE_BADGE);
  });

  it('Related products, with one sub-section per link kind', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('links') });
    const panel = await panelWith(en['productEditor.links.title']!);
    await waitFor(() => expect(within(panel).queryByText(en['productEditor.loading']!)).toBeNull());
    expectSectionsOnly(panel, [en['productEditor.links.title']!]);
    const kinds = [...topSections(panel)[0]!.querySelectorAll('section[data-slot=editor-section] h3')];
    expect(kinds.map((h) => h.textContent)).toEqual(
      ['related', 'up_sell', 'cross_sell'].map((kind) => expect.stringContaining(en[`productEditor.links.kind.${kind}`]!)),
    );
  });

  it('Grouped items', async () => {
    setUp('grouped');
    renderEditor(ProductEditor, { url: at('composite') });
    const panel = await panelWith(en['productEditor.grouped.title']!);
    await within(panel).findByText(CHILD);
    expectSectionsOnly(panel, [en['productEditor.grouped.title']!]);
  });

  it('Bundle slots, as divided rows rather than a box per slot', async () => {
    setUp('bundle');
    renderEditor(ProductEditor, { url: at('composite') });
    const panel = await panelWith(en['productEditor.bundle.title']!);
    const battery = await within(panel).findByRole('heading', { name: /^Battery/ });
    expectSectionsOnly(panel, [en['productEditor.bundle.title']!]);
    expect(battery.tagName).toBe('H3');
    const slot = battery.closest('li')!;
    expect(slot).not.toBeNull();
    expect(slot.className.split(/\s+/)).not.toContain('border');
    expect(slot.parentElement!.className).toMatch(/\bdivide-y\b/);
  });

  it('Inventory: stock, threshold, fulfilment, the warehouse table, order rules and packaging units', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('inventory') });
    const panel = await panelWith(en['inventoryTab.stockMgmt.title']!);
    await within(panel).findByText('Warsaw');
    expectSectionsOnly(panel, [
      en['inventoryTab.stockMgmt.title']!,
      en['inventoryTab.lowStock.title']!,
      en['inventoryTab.fulfilment.title']!,
      en['inventoryTab.table.title']!,
      en['orderRules.title']!,
      en['packagingUnits.title']!,
    ]);
  });

  it('Inventory: the stock summary is a stat line under the warehouse table heading, not a box of its own', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('inventory') });
    const panel = await panelWith(en['inventoryTab.stockMgmt.title']!);
    await within(panel).findByText('Warsaw');
    const table = within(panel).getByRole('region', { name: new RegExp(`^${en['inventoryTab.table.title']!}`) });
    const line = en['inventoryTab.summary.line']!
      .replace('{onHand}', (1240).toLocaleString())
      .replace('{warehouses}', '2');
    expect(table).toHaveAccessibleDescription(line);
  });

  it('Media: one row per image, divided by a rule, not a bordered box per image', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('media') });
    const panel = await panelWith(en['productEditor.gallery.title']!);
    expect(cards(panel)).toEqual([]);
    const item = panel.querySelector<HTMLElement>(`[data-gallery-item="${IMG}"]`)!;
    expect(item.className.split(/\s+/)).not.toContain('border');
    expect(item.parentElement!.className).toMatch(/\bdivide-y\b/);
    expect(topSections(panel)[0]!.querySelector('h2')).toHaveTextContent(en['productEditor.gallery.title']!);
  });

  // Issue #1510 (CAT-10): the attachments are the second section of the "Media & files" tab.
  it('Attachments: one row per file, divided by a rule, the second section of Media & files', async () => {
    setUp('simple');
    renderEditor(ProductEditor, { url: at('media') });
    const panel = await panelWith(en['productEditor.attachments.title']!);
    expect(cards(panel)).toEqual([]);
    await within(panel).findByText('manual.pdf');
    const item = panel.querySelector<HTMLElement>(`[data-attachment="${ATT}"]`)!;
    expect(item.className.split(/\s+/)).not.toContain('border');
    expect(item.parentElement!.className).toMatch(/\bdivide-y\b/);
    const sections = topSections(panel);
    expect(sections.map((section) => section.querySelector('h2')?.textContent)).toEqual([
      expect.stringContaining(en['productEditor.gallery.title']!),
      expect.stringContaining(en['productEditor.attachments.title']!),
    ]);
    // Siblings, so the kit's rule divides them.
    expect(sections[0]!.nextElementSibling).toBe(sections[1]);
  });
});
