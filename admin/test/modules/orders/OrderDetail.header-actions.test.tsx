import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1497 (UX audit SALES-12) — the order header has one primary action.
 *
 * It used to be four outline buttons (Reorder, Clone to quote, Issue invoice,
 * Invoice PDF) with nothing to say which one moves the order forward, and none
 * of them disabled itself while its request ran, so a double press sent it
 * twice. Now *Issue invoice* is the one filled button while the order has no
 * invoice, the order has no primary once it has one, and the rest is in the
 * kit's "More" menu (`DetailHeaderActions`: Von Restorff, Hick, Doherty).
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
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const text = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`no core key ${key}`);
  return value;
};

const ORDER = {
  id: 'o1',
  businessId: 'ORD-0001',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const INVOICE = {
  id: 'inv1',
  kind: 'invoice',
  number: 'FV/1/2026',
  status: 'issued',
  pdfReady: true,
  issuedAt: '2026-05-23T12:00:00Z',
};

function serve(invoices: unknown[]): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    if (path === '/api/v1/admin/invoices?filter[orderId]=o1') return Promise.resolve({ data: invoices });
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['orders', 'payments'] }) },
    ),
    { core: CORE_EN },
  );
}

async function header(): Promise<HTMLElement> {
  await screen.findByRole('button', { name: text('common.action.more') });
  const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]');
  if (group === null) throw new Error('the order header has no DetailHeaderActions');
  return group;
}

/** The filled buttons of the header — the primary, if there is one. */
function filled(group: HTMLElement): HTMLElement[] {
  return within(group)
    .queryAllByRole('button')
    .filter((button) => button.className.split(/\s+/).includes('bg-primary'));
}

/** The primary, once the invoice list has answered and it is drawn. */
async function primaryOf(group: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(filled(group)).toHaveLength(1));
  return filled(group)[0]!;
}

async function openMore(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: text('common.action.more') }));
  return screen.findByRole('menu');
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('OrderDetail — header actions (SALES-12)', () => {
  it('makes Issue invoice the one primary, last, while the order has no invoice', async () => {
    serve([]);
    renderDetail();
    const group = await header();

    await primaryOf(group);
    const primaries = filled(group);
    expect(primaries.map((b) => b.textContent?.trim())).toEqual([text('orderDetail.issueInvoice.action')]);
    const buttons = within(group).getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBe(primaries[0]);
    // The housekeeping actions are not on the header any more.
    expect(within(group).queryByRole('button', { name: text('orderDetail.reorder.action') })).toBeNull();
    expect(within(group).queryByRole('button', { name: text('orderDetail.cloneToQuote.action') })).toBeNull();
  });

  it('puts Reorder and Clone to quote in "More", and no invoice PDF before there is one', async () => {
    serve([]);
    const user = userEvent.setup();
    renderDetail();
    await header();

    const menu = await openMore(user);
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      text('orderDetail.reorder.action'),
      text('orderDetail.cloneToQuote.action'),
    ]);
  });

  it('has no primary once the order has an invoice; issuing again and the PDF are in "More"', async () => {
    serve([INVOICE]);
    const user = userEvent.setup();
    renderDetail();
    const group = await header();
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/invoices?filter[orderId]=o1'));

    await waitFor(() => expect(filled(group)).toEqual([]));
    const menu = await openMore(user);
    const pdf = within(menu).getByRole('menuitem', { name: text('orderDetail.invoicePdf') });
    expect(pdf).toHaveAttribute('href', expect.stringContaining('/api/v1/admin/invoices/inv1/pdf'));
    expect(within(menu).getByRole('menuitem', { name: text('orderDetail.issueInvoice.action') })).toBeInTheDocument();
  });

  it('renders no primary while the invoice list is loading, and none once it shows an invoice', async () => {
    let releaseInvoices!: (value: unknown) => void;
    getSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
      if (path === '/api/v1/admin/orders/statuses') {
        return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
      }
      if (path === '/api/v1/admin/invoices?filter[orderId]=o1') {
        return new Promise((resolve) => (releaseInvoices = resolve));
      }
      return Promise.resolve({ data: [] });
    });
    renderDetail();
    const group = await header();
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/invoices?filter[orderId]=o1'));

    // Not known yet whether the order is invoiced: the slot stays empty rather
    // than flashing a primary that then jumps into "More".
    expect(filled(group)).toEqual([]);
    expect(within(group).queryByRole('button', { name: text('orderDetail.issueInvoice.action') })).toBeNull();

    releaseInvoices({ data: [INVOICE] });
    const user = userEvent.setup();
    const menu = await openMore(user);
    await within(menu).findByRole('menuitem', { name: text('orderDetail.invoicePdf') });
    expect(filled(group)).toEqual([]);
  });

  it('does not count an invoice whose PDF is still rendering as a missing one', async () => {
    serve([{ ...INVOICE, pdfReady: false }]);
    const user = userEvent.setup();
    renderDetail();
    const group = await header();

    await waitFor(() => expect(filled(group)).toEqual([]));
    const menu = await openMore(user);
    expect(within(menu).queryByRole('menuitem', { name: text('orderDetail.invoicePdf') })).toBeNull();
  });

  it('holds every header action while Issue invoice runs, and sends it once', async () => {
    serve([]);
    let release!: (value: unknown) => void;
    postSpy.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderDetail();
    const group = await header();

    const issue = await primaryOf(group);
    await user.click(issue);
    expect(issue).toBeDisabled();
    expect(issue).toHaveAttribute('aria-busy', 'true');
    const more = screen.getByRole('button', { name: text('common.action.more') });
    expect(more).toBeDisabled();
    expect(more).not.toHaveAttribute('aria-busy');
    await user.click(issue);
    expect(postSpy).toHaveBeenCalledTimes(1);

    release({ data: { id: 'i1' }, email: { status: 'not_requested' } });
    await waitFor(() => expect(screen.getByText(text('orderDetail.issueInvoice.done'))).toBeInTheDocument());
  });

  it('marks "More" busy while an entry from it runs', async () => {
    serve([]);
    let release!: (value: unknown) => void;
    postSpy.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderDetail();
    const group = await header();
    await primaryOf(group);

    const menu = await openMore(user);
    await user.click(within(menu).getByRole('menuitem', { name: text('orderDetail.reorder.action') }));
    const more = screen.getByRole('button', { name: text('common.action.more') });
    await waitFor(() => expect(more).toHaveAttribute('aria-busy', 'true'));
    expect(more).toBeDisabled();
    expect(filled(group)[0]).toBeDisabled();
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/o1/reorder', {});

    release({ data: { unavailableItems: [] } });
    await waitFor(() => expect(more).not.toHaveAttribute('aria-busy'));
    expect(more).toBeEnabled();
  });
});
