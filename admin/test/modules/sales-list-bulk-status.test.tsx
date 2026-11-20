import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../helpers/core-bundle';
import { adminSession, withSession } from '../helpers/render-with-session';
import { installOffsetParentShim } from '../helpers/layout-shim';
import { setMobileViewport } from '../setup';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the result of a
 * bulk action on the Orders and Returns lists ("2 changed, 1 skipped") was a
 * success banner above the rows. It is now said in an `InlineStatus` beside the
 * header's actions — the bulk bar that held the button goes away once the
 * selection is cleared, so the header is the place that is still on screen —
 * mounted empty from the first render, so the result is announced. A result
 * that skipped something is a `warning`, not a success.
 */
installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => api.get(...a),
      post: (...a: unknown[]) => api.post(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrdersList } = await import('../../../packages/modules/orders/src/admin/pages/OrdersList');
const { ReturnsList } = await import('../../../packages/modules/returns/src/admin/pages/ReturnsList');

const BUNDLE = {
  ...shippedCoreBundle('en'),
  ...shippedModuleBundle('orders', 'en'),
  ...shippedModuleBundle('returns', 'en'),
};
const core = BUNDLE.core!;
const returns = BUNDLE.returns!;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);

function render(subject: ReactNode): void {
  renderWithI18n(
    withSession(<MemoryRouter>{subject}</MemoryRouter>, { session: adminSession({ permissions: ['*'] }) }),
    BUNDLE,
  );
}

/** The status region in the page header's actions. */
function headerStatus(): HTMLElement {
  const header = screen.getByRole('heading', { level: 1 }).closest('header') ?? document.body;
  const region = within(header)
    .queryAllByRole('status')
    .find((el) => el.tagName === 'P' && el.closest('[data-slot="card"]') === null);
  if (!region) throw new Error('no status region in the page header');
  return region;
}

const noSuccessBanner = (): void =>
  expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => cleanup());

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

const orderRow = (id: string, businessId: string) => ({
  id,
  businessId,
  customerName: 'Jan Kowalski',
  organizationId: ORG_ID,
  organizationName: 'Acme',
  status: 'new',
  statusName: { en: 'New' },
  paymentStatus: 'awaiting_payment',
  total: 10,
  currency: 'PLN',
  placedAt: '2026-05-22T12:00:00Z',
  createdAt: '2026-05-22T12:00:00Z',
  salesChannelId: 'c1',
  salesChannelName: 'Web',
  deliveryMethodName: null,
  paymentMethodName: null,
  shipToName: null,
  billToName: null,
});

function answerOrders(): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return { data: { statuses: [{ code: 'new', name: { en: 'New' }, color: '#000000' }, { code: 'paid', name: { en: 'Paid' }, color: '#000000' }] } };
    }
    if (path.startsWith('/api/v1/admin/orders/list-views')) return { data: [] };
    if (path.startsWith('/api/v1/admin/orders/custom-field-filters')) return { data: [] };
    if (path.startsWith('/api/v1/admin/orders?')) {
      const data = [orderRow('o1', 'ORD-1'), orderRow('o2', 'ORD-2')];
      return { data, pagination: { page: 1, pageSize: 20, total: data.length }, counts: {} };
    }
    return { data: [], items: [] };
  });
}

async function changeStatusOfSelection(): Promise<void> {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select order ORD-1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select order ORD-2' }));
  await userEvent.click(screen.getByRole('button', { name: core['orders.bulk.changeStatus']! }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'paid');
  await userEvent.click(within(dialog).getByRole('button', { name: core['orders.bulk.apply']! }));
}

describe('Orders list — the bulk result beside the header actions (#1499)', () => {
  it('mounts the region empty, then says the result there, with no success banner', async () => {
    answerOrders();
    render(<OrdersList />);
    await screen.findByRole('link', { name: '#ORD-1' });
    const region = headerStatus();
    expect(region.textContent).toBe('');
    api.post.mockResolvedValue({ data: { changed: ['o1', 'o2'], skipped: [] } });

    await changeStatusOfSelection();

    await waitFor(() => expect(region).toHaveTextContent(fill(core['orders.bulk.result']!, { changed: 2, skipped: 0 })));
    expect(region).toHaveAttribute('data-tone', 'success');
    noSuccessBanner();
  });

  it('says a result that skipped orders as a warning', async () => {
    answerOrders();
    render(<OrdersList />);
    await screen.findByRole('link', { name: '#ORD-1' });
    const region = headerStatus();
    api.post.mockResolvedValue({ data: { changed: ['o1'], skipped: [{ orderId: 'o2', reason: 'x' }] } });

    await changeStatusOfSelection();

    await waitFor(() => expect(region).toHaveTextContent(fill(core['orders.bulk.result']!, { changed: 1, skipped: 1 })));
    expect(region).toHaveAttribute('data-tone', 'warning');
  });
});

const returnRow = (id: string, reference: string) => ({
  id,
  rmaNumber: null,
  reference,
  kind: 'return',
  orderId: 'o1',
  offPlatform: false,
  guest: false,
  productLabel: null,
  lineCount: 1,
  purchaseDate: null,
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00Z',
  customerAccountId: null,
  customerName: 'Jan',
  organizationName: 'Acme',
  authorizedBy: null,
});

function answerReturns(): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/returns/statuses')) return { data: { statuses: [], transitions: [] } };
    if (path.startsWith('/api/v1/admin/returns/list-views')) return { data: [] };
    if (path.startsWith('/api/v1/admin/returns?')) {
      const data = [returnRow('a1', '#RMA-1')];
      return { data: { rows: data, total: data.length, counts: {} } };
    }
    return { data: [] };
  });
}

describe('Returns list — the bulk result beside the header actions (#1499)', () => {
  it('says "authorized" in the header region once the bulk bar has gone, with no success banner', async () => {
    answerReturns();
    api.post.mockResolvedValue({ data: { moved: ['a1'], skipped: [] } });
    render(<ReturnsList />);
    await screen.findByRole('link', { name: '#RMA-1' });
    const region = headerStatus();
    expect(region.textContent).toBe('');

    await userEvent.click(screen.getByRole('checkbox', { name: fill(returns['list.selection.selectRow']!, { number: '#RMA-1' }) }));
    await userEvent.click(screen.getByRole('button', { name: fill(core['returns.bulk.authorize']!, { count: 1 }) }));

    await waitFor(() => expect(region).toHaveTextContent(fill(core['returns.bulk.result']!, { authorized: 1, skipped: 0 })));
    expect(screen.queryByRole('button', { name: fill(core['returns.bulk.authorize']!, { count: 1 }) })).toBeNull();
    noSuccessBanner();
  });
});
