import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1440 (UX audit 2026-11-17, DS-06) — the Orders list's toolbar is the
 * one the kit's `ListToolbar` was extracted from, and now renders through it:
 * a named search landmark, the search, status, channel and sort always shown,
 * the rest behind *More filters (n)*, applied filters as removable chips.
 *
 * Its folded filters used to carry `<label htmlFor>` pointing at ids no
 * control had (SALES-24's "labels point at non-existent ids"); every label in
 * the panel now names a control.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');

const EN = { ...shippedCoreBundle('en'), ...shippedModuleBundle('orders', 'en') };
const coreBundle = EN.core as Record<string, string>;
/** The shipped English text of a `core` key; a missing key fails here rather than matching `undefined`. */
function core(key: string): string {
  const text = coreBundle[key];
  if (text === undefined) throw new Error(`missing core key ${key}`);
  return text;
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, color: '#64748b' }] } });
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/orders/custom-field-filters')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [] });
    if (path.startsWith('/api/v1/admin/payment-methods') || path.startsWith('/api/v1/admin/delivery-methods')) {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({ data: [], pagination: { page: 1, pageSize: 20, total: 0 }, counts: {} });
  });
});

function renderList(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <OrdersList />
      </MemoryRouter>,
      // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
      { session: adminSession({ permissions: ['*'] }) },
    ),
    EN,
  );
}

async function toolbar(): Promise<HTMLElement> {
  return screen.findByRole('search', { name: core('orders.toolbar.label') });
}

describe('OrdersList — the kit toolbar', () => {
  it('is a named search landmark holding the search, the primary filters and the list controls', async () => {
    renderList();
    const region = await toolbar();
    expect(within(region).getByRole('searchbox', { name: core('orders.field.search') })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: core('orders.field.status') })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: core('orders.field.salesChannel') })).toBeInTheDocument();
    expect(within(region).getByRole('combobox', { name: core('orders.field.sort') })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: core('common.listToolbar.moreFilters') })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('counts a folded filter in use, and lists it as a removable chip with Clear all filters', async () => {
    const user = userEvent.setup();
    renderList();
    const region = await toolbar();
    await user.click(within(region).getByRole('button', { name: core('common.listToolbar.moreFilters') }));
    await user.type(within(region).getByLabelText(core('orders.field.orgName')), 'Acme');
    await user.click(within(region).getByRole('button', { name: core('common.listToolbar.fewerFilters') }));

    expect(within(region).getByRole('button', { name: 'More filters (1)' })).toBeInTheDocument();
    const chip = within(region).getByRole('button', { name: `Remove filter: ${core('orders.field.orgName')}: Acme` });
    await user.click(within(region).getByRole('button', { name: core('common.listToolbar.clearAll') }));
    await waitFor(() => expect(chip).not.toBeInTheDocument());
    expect(within(region).getByRole('button', { name: core('common.listToolbar.moreFilters') })).toBeInTheDocument();
  });

  it('labels every folded filter: no label points at an id nothing carries', async () => {
    const user = userEvent.setup();
    renderList();
    const region = await toolbar();
    await user.click(within(region).getByRole('button', { name: core('common.listToolbar.moreFilters') }));
    for (const label of region.querySelectorAll('label[for]')) {
      expect(document.getElementById(label.getAttribute('for') ?? ''), label.textContent ?? '').not.toBeNull();
    }
    for (const name of ['orders.field.paymentStatus', 'orders.field.paymentMethod', 'orders.field.deliveryMethod']) {
      expect(within(region).getByRole('button', { name: core(name) })).toBeInTheDocument();
    }
  });

  it('has no WCAG 2.2 AA violation axe can see, folded or open', async () => {
    const user = userEvent.setup();
    renderList();
    const region = await toolbar();
    await expectNoAxeViolations(region);
    await user.click(within(region).getByRole('button', { name: core('common.listToolbar.moreFilters') }));
    await expectNoAxeViolations(region);
  });
});
