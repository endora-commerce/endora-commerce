import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import own from '../../../../packages/modules/quote_requests/i18n/en.json';

/**
 * `specs/192-quote-request-draft-share/` T038 (US1; FR-009) — the quote
 * request list says which quotes the customer cannot see yet, and filters by
 * it: `sharing=unshared|shared` on the list request, read from the address,
 * stored in a saved view and emptied by *Clear filters*. The bundles are the
 * shipped English ones.
 */

const LIST = '/api/v1/admin/quote-requests?';
const VIEWS_ENDPOINT = '/api/v1/admin/quote-requests/list-views';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

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

const OWN = own as Record<string, string>;
const CORE = core as Record<string, string>;

function row(n: number, sharedWithCustomer?: boolean) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    businessId: `RFQ-${n}`,
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    organizationName: 'Acme',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    customerDisplayName: 'Buyer',
    status: 'Created from admin',
    awaitingCustomerRevisionAcceptance: true,
    lineCount: 1,
    currency: 'PLN',
    submittedAt: null,
    expiresAt: null,
    updatedAt: `2026-11-${String(n).padStart(2, '0')}T12:00:00Z`,
    version: 1,
    ...(sharedWithCustomer !== undefined ? { sharedWithCustomer } : {}),
  };
}

function view(id: string, name: string, filters: Record<string, unknown>): SavedListView {
  return {
    id,
    name,
    shared: false,
    ownerAdminUserId: '00000000-0000-4000-8000-0000000000b1',
    ownedByCaller: true,
    canModify: true,
    filters,
  };
}

const UNSHARED_VIEW = view('11111111-1111-4111-8111-111111111111', 'My unshared quotes', { scope: 'all', sharing: 'unshared' });
const PLAIN_VIEW = view('22222222-2222-4222-8222-222222222222', 'Plain', { scope: 'all' });
const ODD_VIEW = view('33333333-3333-4333-8333-333333333333', 'Odd', { scope: 'all', sharing: 'hidden' });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith(VIEWS_ENDPOINT)) return { data: [UNSHARED_VIEW, PLAIN_VIEW, ODD_VIEW] };
    if (path.startsWith(LIST)) {
      const rows = [row(3, false), row(2, true), row(1)];
      return { data: rows, pagination: { page: 1, pageSize: 25, total: rows.length } };
    }
    return { data: [] };
  });
  api.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({
    data: view('55555555-5555-4555-8555-555555555555', String(body['name']), {}),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderList(path = '/quote-requests'): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <RfqList />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    { core: CORE, quote_requests: OWN },
  );
  await screen.findByText('#RFQ-3');
  await screen.findByRole('option', { name: UNSHARED_VIEW.name });
  return user;
}

function sharingSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: OWN['list.sharing.label']! }) as HTMLSelectElement;
}

function lastListRequest(): URLSearchParams {
  const paths = api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST));
  const last = paths[paths.length - 1];
  if (last === undefined) throw new Error('no list request');
  return new URLSearchParams(last.slice(LIST.length));
}

function rowOf(number: string): HTMLElement {
  const link = screen.getAllByRole('link', { name: `#${number}` })[0];
  const tableRow = link?.closest('tr');
  if (!tableRow) throw new Error(`no row for ${number}`);
  return tableRow;
}

describe('RfqList — draft or shared (specs/192-quote-request-draft-share/, FR-009)', () => {
  it('marks the quotes the customer cannot see yet, and only those', async () => {
    await renderList();
    expect(within(rowOf('RFQ-3')).getByText(OWN['share.badge.unshared']!)).toBeInTheDocument();
    // Not awaiting a customer who cannot see it.
    expect(within(rowOf('RFQ-3')).queryByText(CORE['rfq.list.badge.awaitingCustomer']!)).toBeNull();
    expect(within(rowOf('RFQ-2')).queryByText(OWN['share.badge.unshared']!)).toBeNull();
    // A row without the key (a reply that predates the feature) is shared.
    expect(within(rowOf('RFQ-1')).queryByText(OWN['share.badge.unshared']!)).toBeNull();
  });

  it('offers both, shared and not shared, and asks for both by default', async () => {
    await renderList();
    expect(within(sharingSelect()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      OWN['list.sharing.all'],
      OWN['list.sharing.unshared'],
      OWN['list.sharing.shared'],
    ]);
    expect(lastListRequest().has('sharing')).toBe(false);
  });

  it('sends the chosen value from the first page and shows it as a removable filter', async () => {
    const user = await renderList();
    await user.selectOptions(sharingSelect(), 'unshared');

    await waitFor(() => expect(lastListRequest().get('sharing')).toBe('unshared'));
    expect(lastListRequest().get('page')).toBe('1');
    const chip = `${OWN['list.sharing.label']}: ${OWN['list.sharing.unshared']}`;
    expect(screen.getByText(chip)).toBeInTheDocument();

    await user.selectOptions(sharingSelect(), 'shared');
    await waitFor(() => expect(lastListRequest().get('sharing')).toBe('shared'));
  });

  it('reads the filter from the address', async () => {
    await renderList('/quote-requests?sharing=unshared');
    expect(sharingSelect().value).toBe('unshared');
    expect(lastListRequest().get('sharing')).toBe('unshared');
  });

  it('ignores a value the list does not know in the address', async () => {
    await renderList('/quote-requests?sharing=everything');
    expect(sharingSelect().value).toBe('');
    expect(lastListRequest().has('sharing')).toBe(false);
  });

  it('Clear filters empties it', async () => {
    const user = await renderList();
    await user.selectOptions(sharingSelect(), 'unshared');
    await waitFor(() => expect(lastListRequest().get('sharing')).toBe('unshared'));

    await user.click(screen.getAllByRole('button', { name: CORE['common.listToolbar.clearAll']! })[0]!);
    await waitFor(() => expect(lastListRequest().has('sharing')).toBe(false));
    expect(sharingSelect().value).toBe('');
  });

  it('is stored in a saved view', async () => {
    const user = await renderList();
    await user.selectOptions(sharingSelect(), 'unshared');

    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Unshared{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls.find(([path]) => path === VIEWS_ENDPOINT)?.[1] as Record<string, unknown>;
    expect(body['filters']).toMatchObject({ sharing: 'unshared' });
  });

  it('is restored by a saved view, and cleared by one that has none or one the list does not know', async () => {
    const user = await renderList();
    const views = screen.getByRole('combobox', { name: 'Saved views' });

    await user.selectOptions(views, UNSHARED_VIEW.id);
    await waitFor(() => expect(lastListRequest().get('sharing')).toBe('unshared'));
    expect(sharingSelect().value).toBe('unshared');

    await user.selectOptions(views, PLAIN_VIEW.id);
    await waitFor(() => expect(lastListRequest().has('sharing')).toBe(false));
    expect(sharingSelect().value).toBe('');

    await user.selectOptions(views, UNSHARED_VIEW.id);
    await waitFor(() => expect(lastListRequest().get('sharing')).toBe('unshared'));
    await user.selectOptions(views, ODD_VIEW.id);
    await waitFor(() => expect(lastListRequest().has('sharing')).toBe(false));
  });
});
