import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #312 — the Returns list's saved views run on the kit's
 * `SavedViewsControl`, as the order and quote request lists' do. The page owns
 * only the mapping between its state and a `SavedViewState`: what *Save view*
 * posts is the status, kind and RMA-number filters and the sort (the list has
 * no column picker, so a view stores no columns), and what a chosen view does
 * is replace them. The control's own behaviour is covered by
 * `admin/test/components/SavedViewsControl*.test.tsx`.
 *
 * The bundle is the real `core` bundle: the control's buttons and dialog are
 * named by its `savedViews.*` copy, and a passthrough would hide a missing key.
 */

const ENDPOINT = '/api/v1/admin/returns/list-views';
const LIST = '/api/v1/admin/returns?';

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
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
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

const { ReturnsList } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnsList');

const OWNER = '00000000-0000-4000-8000-0000000000a1';

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

/** Every filter the page has, and a non-default sort. */
const NEW_COMPLAINTS = view('11111111-1111-4111-8111-111111111111', 'New complaints', {
  filters: { status: ['new'], kind: 'complaint', rmaNumber: 'RMA-7' },
  sort: { field: 'rmaNumber', dir: 'asc' },
});
/** A colleague's shared view the caller may not modify, with values the page does not know. */
const FOREIGN_SHARED = view('22222222-2222-4222-8222-222222222222', 'Team view', {
  shared: true,
  ownedByCaller: false,
  canModify: false,
  filters: { kind: 'exchange', status: 'new' },
  sort: { field: 'total', dir: 'desc' },
});
/** A view with no sort at all. */
const NO_SORT = view('33333333-3333-4333-8333-333333333333', 'No sort', {
  filters: { kind: 'return' },
  sort: null,
});

const VIEWS = [NEW_COMPLAINTS, FOREIGN_SHARED, NO_SORT];

const STATUSES = [
  { code: 'new', name: { en: 'New' }, defaultName: 'New', color: '#000000', isInitial: true, isTerminal: false },
  { code: 'authorized', name: { en: 'Authorized' }, defaultName: 'Authorized', color: '#000000', isInitial: false, isTerminal: false },
];

function row(id: string, rma: string) {
  return {
    id,
    rmaNumber: rma,
    kind: 'return',
    statusCode: 'new',
    statusLabel: 'New',
    totalRefundAmount: 10,
    currency: 'PLN',
    customerName: 'Jan Kowalski',
    organizationName: 'Acme',
    submittedAt: '2026-08-01T10:00:00Z',
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
    if (path.startsWith('/api/v1/admin/returns/statuses')) return { data: { statuses: STATUSES, transitions: [] } };
    if (path.startsWith(ENDPOINT)) return { data: VIEWS };
    if (path.startsWith(LIST)) return { data: { rows: [row('r1', 'RMA-1')], total: 40, counts: { new: 40 } } };
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
  // No native dialog, whatever the test did.
  expect(nativeDialogs.prompt).not.toHaveBeenCalled();
  expect(nativeDialogs.confirm).not.toHaveBeenCalled();
  expect(nativeDialogs.alert).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function renderList(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      <MemoryRouter>
        <ReturnsList />
      </MemoryRouter>
    </StrictMode>,
    { core: en as Record<string, string> },
  );
  await screen.findByText('RMA-1');
  // StrictMode requests the views twice; only the option proves they arrived.
  await screen.findByRole('option', { name: NEW_COMPLAINTS.name });
  return user;
}

function savedViewsSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;
}

function sortSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement;
}

function kindSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Kind' }) as HTMLSelectElement;
}

function rmaInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'RMA number' }) as HTMLInputElement;
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

function listRequestsSince(before: number): URLSearchParams[] {
  return api.get.mock.calls
    .slice(before)
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(path.indexOf('?') + 1)));
}

describe('ReturnsList — saved views on the kit control (#312)', () => {
  it("mounts the kit's control against the return list's endpoint", async () => {
    await renderList();
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
    const options = within(savedViewsSelect())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['— Select a view —', 'New complaints', 'Team view (shared)', 'No sort']);
    expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeDisabled();
  });

  it('saves the default state as an empty filter set and the default sort', async () => {
    const user = await renderList();
    expect(await saveAs(user, 'Everything')).toEqual({
      name: 'Everything',
      shared: false,
      filters: {},
      sort: { field: 'submittedAt', dir: 'desc' },
    });
  });

  it('saves exactly the filters and sort set on the page', async () => {
    const user = await renderList();

    const statuses = await openMultiSelect(user, 'Status');
    await user.click(within(statuses).getByLabelText('New (40)'));
    await user.keyboard('{Escape}');
    await user.selectOptions(kindSelect(), 'complaint');
    await user.type(rmaInput(), '  RMA-9 ');
    await user.selectOptions(sortSelect(), 'rmaNumber:desc');
    // The RMA filter is saved as the list applies it: debounced and trimmed.
    await waitFor(() => expect(listRequestsSince(0).some((p) => p.get('rmaNumber') === 'RMA-9')).toBe(true));

    expect(await saveAs(user, '  Mine  ')).toEqual({
      name: 'Mine',
      shared: false,
      filters: { status: ['new'], kind: 'complaint', rmaNumber: 'RMA-9' },
      sort: { field: 'rmaNumber', dir: 'desc' },
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("loading a view replaces the page's filters and sort, on the first page", async () => {
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();

    const before = api.get.mock.calls.length;
    await user.selectOptions(savedViewsSelect(), NEW_COMPLAINTS.id);

    expect(sortSelect().value).toBe('rmaNumber:asc');
    expect(kindSelect().value).toBe('complaint');
    expect(rmaInput().value).toBe('RMA-7');
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        listRequestsSince(before).some(
          (p) => p.get('status') === 'new' && p.get('kind') === 'complaint' && p.get('rmaNumber') === 'RMA-7',
        ),
      ).toBe(true),
    );
    // No request after loading carries the old page.
    for (const params of listRequestsSince(before)) expect(params.get('page')).toBe('1');
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeEnabled();
  });

  it('drops values the page does not know and keeps the delete button off a view it may not modify', async () => {
    const user = await renderList();
    await user.selectOptions(savedViewsSelect(), NEW_COMPLAINTS.id);
    await user.selectOptions(savedViewsSelect(), FOREIGN_SHARED.id);

    // Unknown kind and sort fall back to the defaults; a status that is not a list is no filter.
    expect(kindSelect().value).toBe('');
    expect(sortSelect().value).toBe('submittedAt:desc');
    expect(rmaInput().value).toBe('');
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeDisabled();

    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: {},
      sort: { field: 'submittedAt', dir: 'desc' },
    });
  });

  it('a view with no sort loads the default sort', async () => {
    const user = await renderList();
    await user.selectOptions(sortSelect(), 'rmaNumber:asc');
    await user.selectOptions(savedViewsSelect(), NO_SORT.id);

    expect(sortSelect().value).toBe('submittedAt:desc');
    expect(kindSelect().value).toBe('return');
  });
});
