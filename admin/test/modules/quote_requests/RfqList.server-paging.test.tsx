import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #317 — the Quote Request list asks the server for one page: status,
 * search, sort and page travel as parameters, each change is a new request,
 * and the footer shows the server's total rather than the length of an
 * in-memory array.
 */

const LIST = '/api/v1/admin/quote-requests?';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    useAuth: () => ({ me: { role: { code: 'platform_admin' } } }),
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

installOffsetParentShim();

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');

const TOTAL = 45;

function rfq(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    businessId: `RFQ-${n}`,
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Acme',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    customerDisplayName: 'Buyer',
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: false,
    lineCount: 1,
    totalAtCustomerPrice: null,
    totalAtAgreedPrice: null,
    amount: null,
    currency: 'PLN',
    submittedAt: null,
    expiresAt: null,
    updatedAt: '2026-11-01T12:00:00Z',
    version: 1,
  };
}

/** A server that answers the page it is asked for — and only that page. */
function serverPage(path: string) {
  const params = new URLSearchParams(path.slice(LIST.length));
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const first = (page - 1) * pageSize + 1;
  const count = Math.max(0, Math.min(pageSize, TOTAL - first + 1));
  return {
    data: Array.from({ length: count }, (_, i) => rfq(first + i)),
    pagination: { page, pageSize, total: TOTAL, limit: pageSize, hasMore: page * pageSize < TOTAL, nextCursor: null },
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith(LIST)) return serverPage(path);
    return { data: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function listRequests(): URLSearchParams[] {
  return api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(LIST.length)));
}
const lastRequest = (): URLSearchParams => listRequests().at(-1)!;

async function renderList(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>,
      // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
      { session: adminSession({ permissions: ['*'] }) },
    ),
    { core: en as Record<string, string> },
  );
  await screen.findByText('#RFQ-1');
  return user;
}

describe('RfqList — the server reads the page (issue #317)', () => {
  it('asks for the first page, newest change first, and shows the server total', async () => {
    await renderList();
    expect(listRequests()).toHaveLength(1);
    const first = lastRequest();
    expect(first.get('page')).toBe('1');
    expect(first.get('pageSize')).toBe('20');
    expect(first.get('sort')).toBe('updatedAt:desc');
    expect(first.get('assignmentScope')).toBe('all');
    // 45 matches at 20 a page: the footer counts the server's total.
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getAllByText(/^#RFQ-/)).toHaveLength(20);
  });

  it('asks the server for the next page rather than slicing what it has', async () => {
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('#RFQ-21')).toBeInTheDocument();
    expect(lastRequest().get('page')).toBe('2');
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('sends the status filter and returns to the first page', async () => {
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText('#RFQ-21');

    const trigger = screen.getByRole('button', { name: 'Status', expanded: false });
    await user.click(trigger);
    await user.click(within(trigger.parentElement as HTMLElement).getByLabelText('Approved'));
    await waitFor(() => expect(lastRequest().get('status')).toBe('Approved'));
    expect(lastRequest().get('page')).toBe('1');
    // No request paired the new filter with the old page.
    expect(listRequests().some((p) => p.get('status') === 'Approved' && p.get('page') === '2')).toBe(false);
  });

  it('sends the search once typing settles', async () => {
    const user = await renderList();
    const before = listRequests().length;
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), '  RFQ-4 ');
    await waitFor(() => expect(lastRequest().get('q')).toBe('RFQ-4'));
    // One request for the settled search, not one per keystroke.
    expect(listRequests().length).toBe(before + 1);
    expect(lastRequest().get('page')).toBe('1');
  });

  it('sends the sort, including the total ascending', async () => {
    const user = await renderList();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'total:asc');
    await waitFor(() => expect(lastRequest().get('sort')).toBe('total:asc'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'total:desc');
    await waitFor(() => expect(lastRequest().get('sort')).toBe('total:desc'));
  });
});
