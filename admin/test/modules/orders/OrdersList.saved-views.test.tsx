import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 147 (T021, US1; FR-001, FR-011, FR-012) — the order list's saved
 * views run on the kit's `SavedViewsControl` (closes #288). The page owns only
 * the mapping between its state and a `SavedViewState`: what *Save view* posts
 * is `currentView`, and what a chosen view does is `applyView`. The control's
 * own behaviour is covered by `admin/test/components/SavedViewsControl*.test.tsx`.
 *
 * The bundle is the real `core` bundle: the control's buttons and dialog are
 * named by its `savedViews.*` copy, and a passthrough would hide a missing key.
 */

const ENDPOINT = '/api/v1/admin/orders/list-views';

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

const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');

const OWNER = '00000000-0000-4000-8000-0000000000a1';

/** The page's default columns, in option order (`OrdersList.tsx` `DEFAULT_VISIBLE`). */
const DEFAULT_COLUMNS = ['order', 'placedAt', 'salesChannel', 'customer', 'org', 'status', 'payment', 'total'];

function view(id: string, name: string, rest: Partial<SavedListView>): SavedListView {
  return {
    id,
    name,
    shared: false,
    ownerAdminUserId: OWNER,
    ownedByCaller: true,
    canModify: true,
    filters: {},
    ...rest,
  };
}

/** Status filter, a non-default sort, and one column id the page does not know. */
const NEW_BY_TOTAL = view('11111111-1111-4111-8111-111111111111', 'New by total', {
  filters: { status: ['new'] },
  sort: { field: 'total', dir: 'desc' },
  visibleColumns: ['order', 'total', 'retiredColumn'],
});
/** No filters, an explicit sort, and an empty column list. */
const OLDEST_EMPTY_COLUMNS = view('22222222-2222-4222-8222-222222222222', 'Oldest', {
  sort: { field: 'placedAt', dir: 'asc' },
  visibleColumns: [],
});
/** A view saved by a list that stores no sort: `sort` is `null`. */
const NULL_SORT = view('33333333-3333-4333-8333-333333333333', 'Null sort', {
  shared: true,
  filters: { status: ['pending'] },
  sort: null,
  visibleColumns: null,
});
/** The same, with `sort` and `visibleColumns` absent altogether. */
const ABSENT_SORT = view('44444444-4444-4444-8444-444444444444', 'Absent sort', {
  filters: { status: ['new'] },
});

const VIEWS = [NEW_BY_TOTAL, OLDEST_EMPTY_COLUMNS, NULL_SORT, ABSENT_SORT];

function row(id: string, biz: string) {
  return {
    id,
    businessId: biz,
    customerName: 'Jan Kowalski',
    status: 'new',
    statusName: { en: 'New' },
    paymentStatus: 'awaiting_payment',
    organizationId: OWNER,
    organizationName: 'Acme',
    total: 99.5,
    currency: 'PLN',
    placedAt: '2026-05-22T12:00:00Z',
  };
}

let nativeDialogs: {
  prompt: ReturnType<typeof vi.spyOn>;
  confirm: ReturnType<typeof vi.spyOn>;
  alert: ReturnType<typeof vi.spyOn>;
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return { data: { statuses: [{ code: 'new', name: { en: 'New' } }, { code: 'pending', name: { en: 'Pending' } }] } };
    }
    if (path.startsWith(ENDPOINT)) return { data: VIEWS };
    if (path.startsWith('/api/v1/admin/orders/custom-field-filters')) return { data: [] };
    if (path.startsWith('/api/v1/admin/orders')) {
      return { data: [row('o1', 'ORD-1')], pagination: { page: 1, pageSize: 20, total: 1 }, counts: { new: 1 } };
    }
    return { data: [] };
  });
  api.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({
    data: view('55555555-5555-4555-8555-555555555555', String(body['name']), {}),
  }));
  nativeDialogs = {
    prompt: vi.spyOn(window, 'prompt').mockImplementation(() => null),
    confirm: vi.spyOn(window, 'confirm').mockImplementation(() => false),
    alert: vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  };
});

afterEach(() => {
  // FR-001: no native dialog, whatever the test did.
  expect(nativeDialogs.prompt).not.toHaveBeenCalled();
  expect(nativeDialogs.confirm).not.toHaveBeenCalled();
  expect(nativeDialogs.alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderList(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter>
          <OrdersList />
        </MemoryRouter>,
        // The kit pager reads the admin's remembered page size, inside the session (issue #1500).
        { session: adminSession({ permissions: ['*'] }) },
      )}
    </StrictMode>,
    { core: en as Record<string, string> },
  );
  await screen.findByText('#ORD-1');
  // StrictMode requests the list twice; only the option proves it arrived.
  await screen.findByRole('option', { name: NEW_BY_TOTAL.name });
  return user;
}

function savedViewsSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;
}

function sortSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement;
}

/** Opens a `MultiSelect` by its trigger's name and returns its option panel. */
async function openMultiSelect(user: ReturnType<typeof userEvent.setup>, name: string): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name, expanded: false });
  await user.click(trigger);
  return within(trigger.parentElement as HTMLElement).getByRole('listbox');
}

/** Saves the page's current state under `name` and returns the posted body. */
async function saveAs(user: ReturnType<typeof userEvent.setup>, name: string): Promise<unknown> {
  await user.click(screen.getByRole('button', { name: 'Save view' }));
  const dialog = await screen.findByRole('dialog', { name: 'Save view' });
  await user.type(within(dialog).getByLabelText('Name'), `${name}{Enter}`);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const call = api.post.mock.calls.find(([path]) => path === ENDPOINT);
  expect(call).toBeDefined();
  return call?.[1];
}

function listRequested(fragment: string): boolean {
  return api.get.mock.calls.some(
    ([path]) => typeof path === 'string' && path.startsWith('/api/v1/admin/orders?') && path.includes(fragment),
  );
}

describe('OrdersList — saved views on the kit control (feature 147, #288)', () => {
  it("mounts the kit's control against the order list's endpoint", async () => {
    await renderList();
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
    const options = within(savedViewsSelect())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['— Select a view —', 'New by total', 'Oldest', 'Null sort (shared)', 'Absent sort']);
    expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeDisabled();
  });

  it('saves exactly the filters, sort and columns set on the page', async () => {
    const user = await renderList();

    const statuses = await openMultiSelect(user, 'Status');
    await user.click(within(statuses).getByLabelText('New (1)'));
    await user.selectOptions(sortSelect(), 'total:desc');
    const columns = await openMultiSelect(user, 'Columns');
    await user.click(within(columns).getByLabelText('Payment method'));
    await user.click(within(columns).getByLabelText('Sales channel'));

    expect(await saveAs(user, '  Mine  ')).toEqual({
      name: 'Mine',
      shared: false,
      filters: { status: ['new'] },
      sort: { field: 'total', dir: 'desc' },
      visibleColumns: ['order', 'placedAt', 'customer', 'org', 'status', 'payment', 'paymentMethod', 'total'],
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("loading a view replaces the page's filters, sort and columns, dropping unknown column ids", async () => {
    const user = await renderList();
    await user.selectOptions(savedViewsSelect(), NEW_BY_TOTAL.id);

    expect(sortSelect().value).toBe('total:desc');
    await waitFor(() => expect(listRequested('status=new')).toBe(true));
    expect(listRequested('sort=total%3Adesc')).toBe(true);

    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: { status: ['new'] },
      sort: { field: 'total', dir: 'desc' },
      visibleColumns: ['order', 'total'],
    });
  });

  it('an empty column list loads the default columns, and filters are replaced rather than merged', async () => {
    const user = await renderList();
    await user.selectOptions(savedViewsSelect(), NEW_BY_TOTAL.id);
    await user.selectOptions(savedViewsSelect(), OLDEST_EMPTY_COLUMNS.id);

    expect(sortSelect().value).toBe('placedAt:asc');
    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: {},
      sort: { field: 'placedAt', dir: 'asc' },
      visibleColumns: DEFAULT_COLUMNS,
    });
  });

  it('a view whose sort is null loads the default sort and the default columns', async () => {
    const user = await renderList();
    await user.selectOptions(sortSelect(), 'total:desc');
    await user.selectOptions(savedViewsSelect(), NULL_SORT.id);

    expect(sortSelect().value).toBe('placedAt:desc');
    await waitFor(() => expect(listRequested('status=pending')).toBe(true));
    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: { status: ['pending'] },
      sort: { field: 'placedAt', dir: 'desc' },
      visibleColumns: DEFAULT_COLUMNS,
    });
  });

  describe('loading a view returns the list to its first page (FR-011)', () => {
    /** Same filters and sort as the page's defaults; only the columns differ. */
    const COLUMNS_ONLY = view('66666666-6666-4666-8666-666666666666', 'Columns only', {
      sort: { field: 'placedAt', dir: 'desc' },
      visibleColumns: ['order', 'total'],
    });
    /** Only a debounced free-text filter differs from the page's defaults. */
    const TEXT_ONLY = view('77777777-7777-4777-8777-777777777777', 'Text only', {
      filters: { q: 'acme' },
      sort: { field: 'placedAt', dir: 'desc' },
    });

    beforeEach(() => {
      const base = api.get.getMockImplementation();
      api.get.mockImplementation(async (path: string) => {
        if (path.startsWith(ENDPOINT)) return { data: [...VIEWS, COLUMNS_ONLY, TEXT_ONLY] };
        if (path.startsWith('/api/v1/admin/orders?')) {
          return { data: [row('o1', 'ORD-1')], pagination: { page: 1, pageSize: 20, total: 40 }, counts: { new: 40 } };
        }
        return base?.(path);
      });
    });

    function listRequestsSince(before: number): URLSearchParams[] {
      return api.get.mock.calls
        .slice(before)
        .map(([path]) => path)
        .filter((path): path is string => typeof path === 'string' && path.startsWith('/api/v1/admin/orders?'))
        .map((path) => new URLSearchParams(path.slice(path.indexOf('?') + 1)));
    }

    async function goToPageTwo(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.click(screen.getByRole('button', { name: /Next/ }));
      expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
      await waitFor(() => expect(listRequested('page=2')).toBe(true));
    }

    it.each([
      ['a view whose filters and sort differ', NEW_BY_TOTAL.id, (p: URLSearchParams) => p.get('status') === 'new'],
      ['a view whose filters equal the current ones and only the columns differ', COLUMNS_ONLY.id, () => true],
      ['a view where only a text filter differs', TEXT_ONLY.id, (p: URLSearchParams) => p.get('q') === 'acme'],
    ])('%s: no list request after loading carries the old page', async (_label, id, carriesView) => {
      const user = await renderList();
      await goToPageTwo(user);

      const before = api.get.mock.calls.length;
      await user.selectOptions(savedViewsSelect(), id);

      expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
      expect(screen.queryByText('Page 2 of 2')).toBeNull();
      await waitFor(() => expect(listRequestsSince(before).some(carriesView)).toBe(true));
      const requests = listRequestsSince(before);
      expect(requests.length).toBeGreaterThan(0);
      for (const params of requests) expect(params.get('page')).toBe('1');
    });
  });

  it('a view with no sort at all loads the default sort', async () => {
    const user = await renderList();
    await user.selectOptions(sortSelect(), 'businessId:asc');
    await user.selectOptions(savedViewsSelect(), ABSENT_SORT.id);

    expect(sortSelect().value).toBe('placedAt:desc');
    await waitFor(() => expect(listRequested('status=new')).toBe(true));
  });
});
