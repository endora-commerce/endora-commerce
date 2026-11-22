import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1664 (UX audit SALES-24, #1500) — the invoices list was the one sales
 * list left on its own shape: a filter card, a plain table, and *Load more*
 * under it. Its endpoint pages by cursor and answers no total (#1120), so it
 * takes the kit pager in cursor mode: the same footer as every other list, with
 * Previous / Next and "of more than N" instead of a total.
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

const { InvoicesList } = await import('../../../../packages/modules/invoices/src/admin/pages/InvoicesList');

const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('invoices', 'en') };
const core = BUNDLE.core!;
const inv = BUNDLE.invoices!;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const invoice = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  orderId: null,
  orderBusinessId: null,
  salesChannelId: null,
  kind: 'invoice',
  number: `FV/${n}/2026`,
  issuedAt: '2026-11-01T10:00:00.000Z',
  currency: 'PLN',
  total: 100,
  status: 'ready',
  pdfReady: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

/** Answers each list request by its cursor: `pages[cursor ?? '']`. */
function answerPages(pages: Record<string, { rows: ReturnType<typeof invoice>[]; next: string | null }>): void {
  api.get.mockImplementation(async (path: string) => {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const page = pages[query.get('cursor') ?? ''] ?? { rows: [], next: null };
    return {
      data: page.rows,
      pagination: { cursor: page.next, hasMore: page.next !== null, limit: Number(query.get('limit') ?? 50) },
    };
  });
}

const listCalls = (): URLSearchParams[] =>
  api.get.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.startsWith('/api/v1/admin/invoices'))
    .map((p) => new URLSearchParams(p.split('?')[1] ?? ''));

function render(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/invoices']}>
        <InvoicesList />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['invoices', 'document_templates'] }),
      },
    ),
    BUNDLE,
  );
}

const twenty = (from: number): ReturnType<typeof invoice>[] => Array.from({ length: 20 }, (_, i) => invoice(from + i));

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(() => cleanup());

describe('InvoicesList (issue #1664)', () => {
  it('is the kit list page: header, section tabs, a toolbar landmark and one results card', async () => {
    answerPages({ '': { rows: [invoice(1)], next: null } });
    render();
    expect(screen.getByRole('heading', { level: 1, name: core['invoices.title']! })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('search', { name: inv['list.toolbar.label']! })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'FV/1/2026' })).toHaveAttribute(
      'href',
      '/invoices/00000000-0000-4000-8000-000000000001',
    );
  });

  it('pages by cursor with Previous / Next, and has no Load more', async () => {
    answerPages({
      '': { rows: twenty(1), next: 'c-2' },
      'c-2': { rows: [invoice(21), invoice(22)], next: null },
    });
    render();
    expect(await screen.findByText(fill(core['common.pagination.showingRangeMore']!, { start: 1, end: 20 }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    expect(listCalls()[0]!.get('cursor')).toBeNull();
    expect(listCalls()[0]!.get('limit')).toBe('20');

    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    expect(await screen.findByRole('link', { name: 'FV/21/2026' })).toBeInTheDocument();
    // A page replaces the rows on screen; it does not append to them.
    expect(screen.queryByRole('link', { name: 'FV/1/2026' })).toBeNull();
    expect(listCalls().at(-1)!.get('cursor')).toBe('c-2');
    expect(screen.getByText(fill(core['common.pagination.showingRangeOpen']!, { start: 21, end: 22 }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: core['common.pagination.next']! })).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.previous']! }));
    expect(await screen.findByRole('link', { name: 'FV/1/2026' })).toBeInTheDocument();
    expect(listCalls().at(-1)!.get('cursor')).toBeNull();
  });

  it('goes back to the first page when a filter changes', async () => {
    answerPages({ '': { rows: twenty(1), next: 'c-2' }, 'c-2': { rows: [invoice(21)], next: null } });
    render();
    await userEvent.click(await screen.findByRole('button', { name: core['common.pagination.next']! }));
    await screen.findByRole('link', { name: 'FV/21/2026' });
    await userEvent.selectOptions(screen.getByLabelText(core['invoices.fields.status']!), 'pending');
    await waitFor(() => expect(listCalls().at(-1)!.get('filter[status]')).toBe('pending'));
    expect(listCalls().at(-1)!.get('cursor')).toBeNull();
  });

  it('tells "no invoices yet" apart from "nothing matches", and the second clears the filters', async () => {
    answerPages({});
    render();
    expect(await screen.findByText(core['invoices.emptyState.title']!)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(core['invoices.fields.kind']!), 'wz');
    expect(await screen.findByText(core['invoices.empty']!)).toBeInTheDocument();
    const results = screen.getByText(core['invoices.empty']!).closest<HTMLElement>('[data-slot="card"]')!;
    await userEvent.click(within(results).getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    await waitFor(() => expect(listCalls().at(-1)!.get('filter[kind]')).toBeNull());
  });

  it('offers a translated error with Retry when the list cannot be read', async () => {
    api.get.mockRejectedValueOnce(new Error('network'));
    answerPages({ '': { rows: [invoice(1)], next: null } });
    render();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(inv['list.error.load']!);
    await userEvent.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    expect(await screen.findByRole('link', { name: 'FV/1/2026' })).toBeInTheDocument();
  });

  it('keeps the PDF download and the e-mail resend in the row menu, named for the invoice', async () => {
    answerPages({ '': { rows: [invoice(1), invoice(2, { pdfReady: false, status: 'pending' })], next: null } });
    api.post.mockResolvedValue({ data: { sent: true } });
    render();
    const trigger = await screen.findByRole('button', { name: fill(inv['list.rowMenu.label']!, { number: 'FV/1/2026' }) });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: inv['list.rowMenu.pdf']! })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/v1/admin/invoices/00000000-0000-4000-8000-000000000001/pdf'),
    );
    await userEvent.click(within(menu).getByRole('menuitem', { name: inv['list.rowMenu.resendEmail']! }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/invoices/00000000-0000-4000-8000-000000000001/send-email', {});

    const pendingTrigger = screen.getByRole('button', { name: fill(inv['list.rowMenu.label']!, { number: 'FV/2/2026' }) });
    fireEvent.pointerDown(pendingTrigger, { button: 0, ctrlKey: false });
    const pendingMenu = await screen.findByRole('menu');
    expect(within(pendingMenu).getByRole('menuitem', { name: inv['list.rowMenu.pdfNotReady']! })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('renders in Polish from the shipped bundles', async () => {
    const pl = { ...shippedCoreBundle('pl'), ...shippedModuleBundle('invoices', 'pl') };
    answerPages({});
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <InvoicesList />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['invoices'] }) },
      ),
      pl,
      { language: 'pl' },
    );
    expect(await screen.findByText(pl.core!['invoices.emptyState.title']!)).toBeInTheDocument();
  });
});
