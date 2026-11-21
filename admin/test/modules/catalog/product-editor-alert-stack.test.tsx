import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScopeRef } from '@endora-commerce/contracts';
import { BASE, PRODUCT_ID, VALID_SCOPES, api, en, renderEditor, scopedValuesResponse, setUpEditorApi } from './product-editor-harness';

/**
 * Issue #1509 (UX audit 2026-11-17, CAT-09) — no alert stack between the product editor's
 * header and its tabs (Signal-to-Noise, Selective Attention).
 *
 * - An archived product says so in the header: the Archived pill, and Restore beside it — not a
 *   warning banner that pushes the tabs down on every visit to an archived product.
 * - An add/remove in the Related, Grouped and Bundle panels reports its result in the panel's
 *   own always-mounted polite region in the panel header (Doherty: feedback where the operator
 *   worked; WCAG 2.2 SC 4.1.3), not as a polite `Alert` mounted above the panel's content.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const { api: double } = await import('./product-editor-api-double');
  return { ...actual, apiClient: double };
});

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');

const CHILD = '00000000-0000-4000-8000-0000000000e1';
const TARGET = '00000000-0000-4000-8000-0000000000e2';

type ProductType = 'simple' | 'grouped' | 'bundle';

function setUp(type: ProductType, archivedAt: string | null = null): void {
  setUpEditorApi({
    read: (scope: ScopeRef) =>
      scopedValuesResponse({
        scope,
        validScopes: VALID_SCOPES,
        product: { ...scopedValuesResponse().data.product, type, archivedAt },
      }),
    extra: (path) => {
      if (path === `${BASE}/links`) {
        return { data: [{ id: 'l1', sourceProductId: PRODUCT_ID, targetProductId: TARGET, kind: 'up_sell', position: 0 }] };
      }
      if (path === `${BASE}/grouped-items`) {
        return { data: [{ id: 'g1', parentProductId: PRODUCT_ID, childProductId: CHILD, quantity: 1, position: 0 }] };
      }
      if (path === `${BASE}/bundle-slots`) {
        return {
          data: [{ id: 's1', parentProductId: PRODUCT_ID, name: { 'en-US': 'Battery' }, minQuantity: 0, maxQuantity: 1, position: 0, options: [] }],
        };
      }
      return undefined;
    },
  });
  api.post.mockImplementation(async (path: string) => {
    if (path === '/api/v1/admin/catalog/products/batch-by-id') {
      return { data: [{ id: TARGET, sku: 'TGT-1', slug: 'target', name: 'Target chair', status: 'active', archivedAt: null }], pagination: { hasMore: false } };
    }
    return { data: null };
  });
  api.delete.mockResolvedValue({ data: null });
}

afterEach(() => cleanup());

const at = (tab: string): string => `/catalog/products/${PRODUCT_ID}?scope=global&tab=${tab}`;

/** Every `Alert` rendered between the page header and the tab list. */
function alertsAboveTabs(): Element[] {
  const tablist = screen.getByRole('tablist');
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  return [...document.querySelectorAll('[data-slot=alert]')].filter(
    (el) =>
      header.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
      el.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING &&
      !header.contains(el),
  );
}

/** The panel's own result region: the `role="status"` inside the section header. */
async function sectionStatus(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name: new RegExp(`^${title}`) });
  const section = heading.closest('section')!;
  const region = section.querySelector<HTMLElement>('[data-testid$="-panel-status"]');
  expect(region, `${title} has its own status region`).not.toBeNull();
  return region!;
}

async function confirmRemoval(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: en['productEditor.confirmRemoval.confirm']! }));
}

describe('an archived product says so in the header, with Restore beside the pill (#1509)', () => {
  it('draws no archived banner above the tabs; the header holds the pill and Restore', async () => {
    setUp('simple', '2026-10-20T00:00:00.000Z');
    renderEditor(ProductEditor);
    const head = (await screen.findByRole('heading', { level: 1 })).closest('header')!;
    await within(head).findByText(en['productsList.status.archived']!);
    expect(screen.queryByTestId('product-archived-notice')).toBeNull();
    expect(alertsAboveTabs()).toEqual([]);
    const restore = within(head).getByRole('button', { name: en['productEditor.action.restore']! });
    // What the old banner said is the button's description, so it is not lost.
    expect(restore).toHaveAccessibleDescription(`${en['productEditor.archived.title']} ${en['productEditor.archived.body']}`);
  });

  it('a product that is not archived draws nothing above the tabs on load', async () => {
    setUp('simple');
    renderEditor(ProductEditor);
    await screen.findByRole('heading', { level: 1 });
    await screen.findByRole('tablist');
    expect(alertsAboveTabs()).toEqual([]);
    expect(screen.queryByRole('button', { name: en['productEditor.action.restore']! })).toBeNull();
  });
});

describe('panel results are said in the panel header, not in a polite Alert (#1509)', () => {
  it('Related: a removed link is said in the panel status region, mounted empty before', async () => {
    setUp('simple');
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: at('links') });
    const region = await sectionStatus(en['productEditor.links.title']!);
    // Mounted empty before there is anything to say.
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveTextContent('');
    await user.click(await screen.findByRole('button', { name: en['productEditor.links.action.removeFor']!.replace('{product}', 'Target chair') }));
    await confirmRemoval(user);
    await waitFor(() => expect(region).toHaveTextContent(en['productEditor.links.success.remove']!));
    expect(screen.getByRole('tabpanel').querySelector('[data-slot=alert]')).toBeNull();
  });

  it('Grouped: a removed child is said in the panel status region', async () => {
    setUp('grouped');
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: at('composite') });
    const region = await sectionStatus(en['productEditor.grouped.title']!);
    await user.click(await screen.findByRole('button', { name: en['productEditor.grouped.action.removeFor']!.replace('{product}', CHILD) }));
    await confirmRemoval(user);
    await waitFor(() => expect(region).toHaveTextContent(en['productEditor.grouped.success.remove']!));
    expect(screen.getByRole('tabpanel').querySelector('[data-slot=alert]')).toBeNull();
  });

  it('Bundle: a removed slot is said in the panel status region; a refusal is an Alert and clears it', async () => {
    setUp('bundle');
    const user = userEvent.setup();
    renderEditor(ProductEditor, { url: at('composite') });
    const region = await sectionStatus(en['productEditor.bundle.title']!);
    const remove = (): Promise<HTMLElement> =>
      screen.findByRole('button', { name: en['productEditor.bundle.action.deleteSlotFor']!.replace('{slot}', 'Battery') });
    await user.click(await remove());
    await confirmRemoval(user);
    await waitFor(() => expect(region).toHaveTextContent(en['productEditor.bundle.success.removeSlot']!));
    expect(screen.getByRole('tabpanel').querySelector('[data-slot=alert]')).toBeNull();

    api.delete.mockRejectedValueOnce(new Error('boom'));
    await user.click(await remove());
    await confirmRemoval(user);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en['productEditor.bundle.error.deleteSlot']!));
    expect(region).toHaveTextContent('');
  });
});
