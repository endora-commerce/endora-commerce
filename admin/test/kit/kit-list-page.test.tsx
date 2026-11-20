import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import {
  ListPage,
  fitPageSize,
  lastPageIndex,
  pageSizesUpTo,
  useCursorPagination,
  useListPagination,
  type CursorListPagination,
  type ListPageLoad,
  type ListPagination,
} from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';
import { adminSession, withSession } from '../helpers/render-with-session';

/**
 * Issue #1439 (UX audit DS-05) — the kit's list page pattern: `ListPage` (the
 * header with its "New …", a toolbar row that is not a card, one results
 * region, the pager) and `useListPagination` (page state fitted to what the
 * endpoint serves).
 */

const en = shippedCoreBundle('en');
const core = en.core!;
// The remembered page size is the signed-in admin's preference, so the
// harness sits under the real session provider.
const session = adminSession({ permissions: ['*'] });
const wrap = (ui: ReactNode): ReactElement => withSession(<>{ui}</>, { session });

describe('page sizes a list can serve', () => {
  it('offers the shared sizes up to the endpoint maximum', () => {
    expect(pageSizesUpTo(100)).toEqual([5, 10, 20, 50, 100]);
    expect(pageSizesUpTo(200)).toEqual([5, 10, 20, 50, 100]);
    expect(pageSizesUpTo(500)).toEqual([5, 10, 20, 50, 100, 500]);
  });

  it('never offers an empty dropdown', () => {
    expect(pageSizesUpTo(1)).toEqual([5]);
  });

  it('fits a remembered size the list does not offer to the largest one below it', () => {
    expect(fitPageSize(500, [5, 10, 20, 50, 100])).toBe(100);
    expect(fitPageSize(20, [5, 10, 20, 50, 100])).toBe(20);
    expect(fitPageSize(5, [20, 50])).toBe(20);
  });

  it('names the last page, zero-based, and page 0 for an empty list', () => {
    expect(lastPageIndex(0, 20)).toBe(0);
    expect(lastPageIndex(20, 20)).toBe(0);
    expect(lastPageIndex(41, 20)).toBe(2);
  });
});

function Harness({
  load,
  total,
  onPager,
  onRetry,
  children = <p>rows</p>,
}: {
  load: ListPageLoad;
  total: number;
  onPager?: (pager: ListPagination) => void;
  onRetry?: () => void;
  children?: ReactNode;
}): ReactNode {
  const pager = useListPagination({ scope: 'kit-list-page-test', maxPageSize: 100 });
  useEffect(() => {
    onPager?.(pager);
  });
  return (
    <ListPage
      title="Customers"
      actions={<button type="button">New customer</button>}
      toolbar={
        <label>
          Search
          <input type="search" />
        </label>
      }
      count={`${total} customers`}
      load={load}
      {...(onRetry ? { onRetry } : {})}
      pagination={pager.footer(total)}
    >
      {children}
    </ListPage>
  );
}

describe('ListPage', () => {
  it('mounts the count live region before it has text, and announces loading through it', () => {
    const { rerender } = renderWithI18n(wrap(<Harness load={{ kind: 'loading' }} total={0} />), en);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(core['common.state.loading']!);
    expect(screen.getByTestId('list-page-skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('list-page-skeleton').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('rows')).toBeNull();

    rerender(wrap(<Harness load={{ kind: 'ready' }} total={42} />));
    // The same node, so the change is announced rather than a new region arriving full.
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('42 customers');
  });

  it('draws the toolbar as a row, not a card, and the header action as the page action', () => {
    renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={3} />), en);
    const heading = screen.getByRole('heading', { level: 1, name: 'Customers' });
    expect(heading.closest('header')).toContainElement(screen.getByRole('button', { name: 'New customer' }));
    const search = screen.getByRole('searchbox', { name: 'Search' });
    expect(search.closest('.rounded-lg.border')).toBeNull();
  });

  it('offers a retry beside a load error, and shows the generic copy when the server gave none', async () => {
    const onRetry = vi.fn();
    renderWithI18n(wrap(<Harness load={{ kind: 'error' }} total={0} onRetry={onRetry} />), en);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(core['common.list.loadError']!);
    await userEvent.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('rows')).toBeNull();
    expect(screen.queryByText(core['common.pagination.previous']!)).toBeNull();
  });

  it('shows the server message on a load error when there is one', () => {
    renderWithI18n(wrap(<Harness load={{ kind: 'error', message: 'Forbidden for this scope.' }} total={0} />), en);
    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden for this scope.');
  });

  it('draws the pager under rows, and none under an empty list', () => {
    const { rerender } = renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={45} />), en);
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();
    rerender(wrap(<Harness load={{ kind: 'ready' }} total={0} children={<p>nothing yet</p>} />));
    expect(screen.getByText('nothing yet')).toBeInTheDocument();
    expect(screen.queryByText(core['common.pagination.rowsPerPage']!)).toBeNull();
  });

  it('renders in Polish from the shipped bundle', () => {
    const pl = shippedCoreBundle('pl');
    renderWithI18n(wrap(<Harness load={{ kind: 'loading' }} total={0} />), pl, { language: 'pl' });
    expect(screen.getByRole('status')).toHaveTextContent(pl.core!['common.state.loading']!);
  });

  it('has no axe violations when ready', async () => {
    const { container } = renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={45} />), en);
    await expectNoAxeViolations(container);
  });
});

describe('useListPagination', () => {
  it('pages forward and back within the total, and asks for a one-based page', async () => {
    let pager!: ListPagination;
    renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={45} onPager={(p) => (pager = p)} />), en);
    expect(pager.query).toEqual({ page: 1, pageSize: 20 });
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    expect(pager.query).toEqual({ page: 3, pageSize: 20 });
    expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: core['common.pagination.next']! })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.previous']! }));
    expect(pager.query.page).toBe(2);
  });

  it('offers only the sizes the endpoint serves, and goes back to the first page on a size change', async () => {
    let pager!: ListPagination;
    renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={250} onPager={(p) => (pager = p)} />), en);
    const select = screen.getByLabelText(core['common.pagination.rowsPerPage']!);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['5', '10', '20', '50', '100']);
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    expect(pager.page).toBe(1);
    await userEvent.selectOptions(select, '50');
    expect(pager.query).toEqual({ page: 1, pageSize: 50 });
  });

  it('moves back to the last page that exists when the total shrinks under it', async () => {
    let pager!: ListPagination;
    renderWithI18n(wrap(<Harness load={{ kind: 'ready' }} total={45} onPager={(p) => (pager = p)} />), en);
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    expect(pager.page).toBe(2);
    act(() => pager.syncTotal(21));
    expect(pager.page).toBe(1);
    act(() => pager.syncTotal(0));
    expect(pager.page).toBe(0);
    act(() => pager.resetPage());
    expect(pager.query.page).toBe(1);
  });
});

/**
 * Issue #1664 — the pager's cursor mode, for a list whose endpoint pages by an
 * opaque cursor and answers no total (the invoices list, #1120). Previous and
 * Next, the page number without "of Y", and a "more than N" hint while a next
 * page exists.
 */
function CursorHarness({
  rows,
  onPager,
}: {
  rows: number;
  onPager?: (pager: CursorListPagination) => void;
}): ReactNode {
  const pager = useCursorPagination({ scope: 'kit-cursor-page-test', maxPageSize: 100 });
  useEffect(() => {
    onPager?.(pager);
  });
  return (
    <ListPage title="Invoices" load={{ kind: 'ready' }} pagination={pager.footer(rows)}>
      <p>rows</p>
    </ListPage>
  );
}

describe('useCursorPagination', () => {
  const next = (): HTMLElement => screen.getByRole('button', { name: core['common.pagination.next']! });
  const previous = (): HTMLElement => screen.getByRole('button', { name: core['common.pagination.previous']! });

  it('asks for the first page with no cursor, and offers Next only once a response says more exist', () => {
    let pager!: CursorListPagination;
    renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    expect(pager.query).toEqual({ cursor: null, limit: 20 });
    expect(next()).toBeDisabled();
    expect(previous()).toBeDisabled();
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    expect(next()).toBeEnabled();
    expect(screen.getByText('Showing 1–20 of more than 20')).toBeInTheDocument();
    expect(screen.getByText(fill(core['cursorPagination.page']!, { page: 1 }))).toBeInTheDocument();
    // No total, so no "of Y" anywhere.
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
  });

  it('walks forward by the cursor each page answered, and back the way it came', async () => {
    let pager!: CursorListPagination;
    const { rerender } = renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    await userEvent.click(next());
    expect(pager.query).toEqual({ cursor: 'c-2', limit: 20 });
    expect(pager.page).toBe(1);
    act(() => pager.syncPage({ cursor: 'c-3', hasMore: true }, 20));
    await userEvent.click(next());
    expect(pager.query.cursor).toBe('c-3');
    rerender(wrap(<CursorHarness rows={5} onPager={(p) => (pager = p)} />));
    act(() => pager.syncPage({ cursor: null, hasMore: false }, 5));
    // The last page: the range, and no claim about a total.
    expect(screen.getByText('Showing 41–45')).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await userEvent.click(previous());
    expect(pager.query.cursor).toBe('c-2');
    await userEvent.click(previous());
    expect(pager.query.cursor).toBeNull();
    expect(previous()).toBeDisabled();
  });

  it('does not skip a page when Next is pressed again before the page answers', async () => {
    let pager!: CursorListPagination;
    renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    await userEvent.click(next());
    expect(next()).toBeDisabled();
    expect(pager.page).toBe(1);
  });

  it('goes back to the first page on a size change and on resetPage', async () => {
    let pager!: CursorListPagination;
    renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    const select = screen.getByLabelText(core['common.pagination.rowsPerPage']!);
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['5', '10', '20', '50', '100']);
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    await userEvent.click(next());
    await userEvent.selectOptions(screen.getByLabelText(core['common.pagination.rowsPerPage']!), '50');
    expect(pager.query).toEqual({ cursor: null, limit: 50 });
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 50));
    await userEvent.click(next());
    act(() => pager.resetPage());
    expect(pager.query.cursor).toBeNull();
  });

  it('steps back when a later page comes back empty', async () => {
    let pager!: CursorListPagination;
    renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    await userEvent.click(next());
    act(() => pager.syncPage({ cursor: null, hasMore: false }, 0));
    expect(pager.page).toBe(0);
    expect(pager.query.cursor).toBeNull();
  });

  it('draws no pager under an empty first page', () => {
    renderWithI18n(wrap(<CursorHarness rows={0} />), en);
    expect(screen.queryByText(core['common.pagination.rowsPerPage']!)).toBeNull();
  });

  it('renders the hint in Polish from the shipped bundle', () => {
    const pl = shippedCoreBundle('pl');
    let pager!: CursorListPagination;
    renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), pl, { language: 'pl' });
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    expect(
      screen.getByText(fill(pl.core!['common.pagination.showingRangeMore']!, { start: 1, end: 20 })),
    ).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    let pager!: CursorListPagination;
    const { container } = renderWithI18n(wrap(<CursorHarness rows={20} onPager={(p) => (pager = p)} />), en);
    act(() => pager.syncPage({ cursor: 'c-2', hasMore: true }, 20));
    await expectNoAxeViolations(container);
  });
});

describe('ListPage tabs', () => {
  it('draws section tabs between the header and the toolbar', () => {
    renderWithI18n(
      wrap(
        <ListPage title="Invoices" tabs={<nav aria-label="Sections">tabs</nav>} toolbar={<input aria-label="Search" />} load={{ kind: 'ready' }}>
          <p>rows</p>
        </ListPage>,
      ),
      en,
    );
    const tabs = screen.getByRole('navigation', { name: 'Sections' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Invoices' });
    const search = screen.getByRole('textbox', { name: 'Search' });
    expect(heading.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
