import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ScopeRef } from '@endora-commerce/contracts';
import {
  BASE,
  CH_RETAIL,
  PRODUCT_ID,
  VALID_SCOPES,
  en,
  renderEditor,
  scopedField,
  scopedValuesResponse,
  setUpEditorApi,
} from './product-editor-harness';

/**
 * Issue #1490 (UX audit 2026-11-17, CAT-11) — the product editor has one heading outline: the
 * page's `h1`, a tab's sections as `h2`, their sub-sections as `h3`, and no level skipped (WCAG 2.2
 * SC 1.3.1 / 2.4.6). A tab's panel is already named by its tab, so no heading in it says the tab's
 * name over a section that has a name of its own — the scope map's "Scope map" `h3` did, above
 * the map and its "No longer applies" `h4`.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const IMG = '00000000-0000-4000-8000-0000000000c1';
const ATT = '00000000-0000-4000-8000-0000000000d1';
const WH = '00000000-0000-4000-8000-0000000000a1';

type ProductType = 'simple' | 'configurable' | 'grouped' | 'bundle';

const ORPHAN = { field: 'name', channelId: CH_RETAIL, languageCode: 'de-DE', reason: 'language_not_offered' };

function setUp(type: ProductType, orphans: readonly unknown[] = []): void {
  setUpEditorApi({
    read: (scope: ScopeRef) =>
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
      }),
    extra: (path) => {
      if (path === `${BASE}/bundle-slots`) {
        return { data: [{ id: 's1', parentProductId: PRODUCT_ID, name: { 'en-US': 'Battery' }, minQuantity: 0, maxQuantity: 1, position: 0, options: [] }] };
      }
      if (path === '/api/v1/admin/catalog/attributes/by-flag?flag=isVariantAxis') return { data: { items: [] } };
      if (path.startsWith('/api/v1/admin/warehouses')) return { items: [{ id: WH, code: 'WA', name: 'Warsaw', isDefault: true }] };
      if (path.startsWith('/api/v1/admin/inventory/levels')) {
        return { items: [{ productId: PRODUCT_ID, perWarehouse: [{ warehouseId: WH, onHand: 12, lowStockThreshold: null }] }] };
      }
      if (path === '/api/v1/admin/settings/inventory.allow_negative_stock') {
        return { code: 'inventory.allow_negative_stock', globalValue: true, defaultValue: false };
      }
      if (path === `${BASE}/scope-overview`) {
        return {
          data: {
            channels: [{ channelId: CH_RETAIL, name: { 'en-US': 'Retail PL' }, isMember: true, languages: ['pl-PL'] }],
            languages: ['pl-PL'],
            cells: [{ channelId: CH_RETAIL, languageCode: 'pl-PL', available: true, effectiveStatus: 'active', statusSource: 'global', overriddenFields: [], missing: [] }],
            channelRows: [{ channelId: CH_RETAIL, overriddenFields: [] }],
            orphans,
          },
        };
      }
      return undefined;
    },
  });
}

afterEach(() => cleanup());

const at = (tab: string): string => `/catalog/products/${PRODUCT_ID}?scope=global&tab=${tab}`;

/** The heading levels of the page, in document order: the `h1`, then everything in the tab panel. */
function outline(): { level: number; text: string }[] {
  const page = [...document.querySelectorAll<HTMLElement>('h1')];
  const panel = [...screen.getByRole('tabpanel').querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  return [...page, ...panel].map((h) => ({ level: Number(h.tagName.slice(1)), text: (h.textContent ?? '').trim() }));
}

/** One `h1`, the panel opening at `h2`, and every heading at most one level below the one before it. */
function expectNoSkippedLevel(): void {
  const levels = outline().map((h) => h.level);
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  if (levels.length > 1) expect(levels[1]).toBe(2);
  for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeLessThanOrEqual(levels[i - 1]! + 1);
}

const CASES: { tab: string; type: ProductType; ready: () => Promise<unknown> }[] = [
  { tab: 'details', type: 'simple', ready: () => screen.findByRole('heading', { name: en['productEditor.section.identity']! }) },
  { tab: 'variants', type: 'configurable', ready: () => screen.findByRole('heading', { name: new RegExp(`^${en['productEditor.variants.title']!}`) }) },
  { tab: 'composite', type: 'bundle', ready: () => screen.findByRole('heading', { name: /^Battery/ }) },
  // Issue #1510 (CAT-10): "Media & files" holds the gallery and the attachments, both h2 sections.
  { tab: 'media', type: 'simple', ready: () => Promise.all([screen.findByRole('heading', { name: new RegExp(`^${en['productEditor.gallery.title']!}`) }), screen.findByText('manual.pdf')]) },
  { tab: 'inventory', type: 'simple', ready: () => screen.findByText('Warsaw') },
  { tab: 'links', type: 'simple', ready: () => screen.findByRole('heading', { name: new RegExp(`^${en['productEditor.links.title']!}`) }) },
];

describe('the product editor has one heading outline (issue #1490, CAT-11)', () => {
  for (const { tab, type, ready } of CASES) {
    it(`${tab}: h1, then h2 sections, then h3 sub-sections, with no level skipped`, async () => {
      setUp(type);
      renderEditor(ProductEditor, { url: at(tab) });
      await ready();
      await waitFor(() => expect(within(screen.getByRole('tabpanel')).queryByText(en['productEditor.loading']!)).toBeNull());
      expectNoSkippedLevel();
    });
  }

  it('Scope map drawer (#1510): its title is the h2, the map and its orphans two h3 sections below it', async () => {
    setUp('simple', [ORPHAN]);
    renderEditor(ProductEditor, { url: `/catalog/products/${PRODUCT_ID}?scope=global&scopeMap=1` });
    const drawer = await screen.findByRole('dialog', { name: en['productEditor.scope.scopeMap']! });
    await within(drawer).findByRole('table');
    const headings = [...drawer.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].map((h) => ({
      level: Number(h.tagName.slice(1)),
      text: (h.textContent ?? '').trim(),
    }));
    expect(headings).toEqual([
      { level: 2, text: en['productEditor.scope.scopeMap']! },
      { level: 3, text: en['productEditor.scopeOverview.matrix.title']! },
      { level: 3, text: en['productEditor.scopeOverview.orphans.title']! },
    ]);
    // The map's one-line help describes its section.
    expect(screen.getByRole('region', { name: en['productEditor.scopeOverview.matrix.title']! })).toHaveAccessibleDescription(
      en['productEditor.scopeOverview.help']!,
    );
  });
});
