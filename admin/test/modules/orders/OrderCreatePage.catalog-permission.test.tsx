import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 145 QA — two host-level assertions the shared-component suites cannot make.
 *
 * FR-013: the permission gate is proved on the trigger and on the picker in isolation
 * (`kit-product-browser`, `kit-pickers`); this proves **Create order** actually mounts both
 * gated components, so an operator holding `orders:write` but not `catalog:read` is told why
 * instead of getting a live control that fails after opening.
 *
 * Edge Cases, "Already-added products": removing a line makes its product selectable again —
 * asserted on the quote-request screen only until now.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

const { OrderCreatePage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderCreatePage');

const CORE: Record<string, string> = JSON.parse(
  readFileSync(join(resolve(process.cwd(), '..'), 'packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE: Bundle = { core: CORE };

const ROWS = ['a01', 'a02'].map((id, i) => ({
  id,
  sku: `SKU-${id.toUpperCase()}`,
  slug: id,
  name: { 'en-US': `Widget 0${i + 1}` },
  status: 'active',
  type: 'simple',
}));

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  window.localStorage.clear();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/catalog/products?')) {
      return Promise.resolve({
        data: ROWS,
        pagination: { page: 0, pageSize: 20, total: ROWS.length },
        counts: { all: 2, active: 2, inactive: 0, archived: 0 },
      });
    }
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: 'chan-1', code: 'CH', name: { 'en-US': 'Channel 1' }, active: true }] });
    }
    if (path.includes('/addresses')) return Promise.resolve({ data: { personal: [], organization: [] } });
    if (path === '/api/v1/admin/customers/cust-1') {
      return Promise.resolve({ data: { id: 'cust-1', email: 'j@a.test', firstName: 'Jan', lastName: 'K', organizationName: 'Acme' } });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string, body: { items: Array<{ productId: string; quantity: number }> }) => {
    if (path.endsWith('/orders/preview')) {
      const lines = body.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: '10.00',
        currency: 'PLN',
        lineTotal: 10 * it.quantity,
      }));
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      return Promise.resolve({
        data: {
          lines,
          summary: { subtotal, taxTotal: 0, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, total: subtotal, currency: 'PLN' },
          messages: [],
        },
      });
    }
    return Promise.resolve({ data: { id: 'o1' } });
  });
});

function renderPage(permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/new?customerAccountId=cust-1&salesChannelId=chan-1']}>
        <OrderCreatePage />
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['orders', 'quick_order'] }) },
    ),
    BUNDLE,
  );
}

describe('OrderCreatePage — product picking permission (FR-013) and re-selection', () => {
  it('disables Browse products and the quick search, each with the permission hint, without catalog:read', async () => {
    renderPage(['orders:write', 'customers:read']);

    const browse = await screen.findByRole('button', { name: CORE['productBrowser.trigger']! });
    expect(browse).toBeDisabled();
    expect(document.getElementById(browse.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      CORE['productBrowser.trigger.noPermission'],
    );

    const quick = screen.getByRole('combobox', { name: CORE['orderCreate.items.quickSearch']! });
    expect(quick).toBeDisabled();
    expect(document.getElementById(quick.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      CORE['productBrowser.trigger.noPermission'],
    );
    // Nothing was asked of the catalogue by an operator who may not read it.
    expect(getSpy.mock.calls.some(([p]) => String(p).startsWith('/api/v1/admin/catalog/products'))).toBe(false);
  });

  it('enables both with catalog:read', async () => {
    renderPage(['orders:write', 'customers:read', 'catalog:read']);
    expect(await screen.findByRole('button', { name: CORE['productBrowser.trigger']! })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: CORE['orderCreate.items.quickSearch']! })).toBeEnabled();
  });

  it('keeps a product selectable while it is a line and once its line is removed (feature 159, N-31)', async () => {
    const user = userEvent.setup();
    renderPage(['*']);
    const open = async (): Promise<HTMLElement> => {
      await user.click(await screen.findByRole('button', { name: CORE['productBrowser.trigger']! }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(within(dialog).queryAllByRole('checkbox').length).toBeGreaterThan(1));
      return dialog;
    };

    let dialog = await open();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Widget 01' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await open();
    // One product may be on several lines: it is offered again.
    expect(within(dialog).getByRole('checkbox', { name: 'Select Widget 01' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: new RegExp(`${CORE['common.action.delete']}.*Widget 01`) }));
    await waitFor(() => expect(document.querySelectorAll('[data-line-name]').length).toBe(0));

    dialog = await open();
    expect(within(dialog).getByRole('checkbox', { name: 'Select Widget 01' })).toBeEnabled();
  });
});
