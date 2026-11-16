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
 * Feature 147 (T050, US3; FR-010 – FR-012, FR-016, FR-017) — saved views on the
 * Quote Request list (closes #290). The page owns only the mapping between its
 * state and a `SavedViewState`: a view stores scope, organization, status,
 * search, sort and columns; loading one replaces all six, returns the list to
 * its first page, and drops what the page no longer knows. Visibility stays the
 * loader's: the list request after a load is the loader's own, and an
 * organization the loader cannot see is never named on the screen. The
 * control's own behaviour is `admin/test/components/SavedViewsControl*.test.tsx`.
 *
 * The bundle is the real `core` one: both the control's `savedViews.*` copy and
 * the page's `rfq.list.*` copy live there, and a passthrough would hide a
 * missing key. `OrganizationPicker` is the real one — FR-017 is about what it
 * requests and renders.
 */

const ENDPOINT = '/api/v1/admin/quote-requests/list-views';
const LIST = '/api/v1/admin/quote-requests?';
const ORGANIZATIONS = '/api/v1/admin/organizations';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

/** The loader's role; `platform_admin` defaults the scope to `all`, anyone else to `mine`. */
const auth = vi.hoisted(() => ({ role: 'platform_admin' }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    useAuth: () => ({ me: { role: { code: auth.role } } }),
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

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');

const OWNER = '00000000-0000-4000-8000-0000000000b1';
const ACME = '00000000-0000-4000-8000-0000000000a1';
/** An organization outside the loader's scope: in neither the rows nor the picker's results. */
const FOREIGN = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const FOREIGN_NAME = 'Globex Hidden Holdings';

/** The page's default columns, in option order (`RfqList.tsx` `DEFAULT_VISIBLE`). */
const DEFAULT_COLUMNS = ['rfq', 'org', 'customer', 'status', 'lines', 'total'];

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

/** All six parts, plus an unknown status, an unknown filter key and an unknown column id. */
const FULL = view('11111111-1111-4111-8111-111111111111', 'Pending Acme', {
  filters: { scope: 'unassigned', organizationId: ACME, status: ['Pending', 'Archived'], q: 'acme', colour: 'red' },
  sort: { field: 'total', dir: 'desc' },
  visibleColumns: ['rfq', 'total', 'retiredColumn'],
});
/** No scope, an unknown sort and an empty column list. */
const NO_SCOPE = view('22222222-2222-4222-8222-222222222222', 'Approved', {
  filters: { status: ['Approved'] },
  sort: { field: 'businessId', dir: 'asc' },
  visibleColumns: [],
});
/** Scope `all`, no sort, no columns. */
const ALL_SCOPE = view('33333333-3333-4333-8333-333333333333', 'Everything', {
  shared: true,
  filters: { scope: 'all' },
  sort: null,
  visibleColumns: null,
});
/** A colleague's shared view naming an organization the loader cannot see. */
const FOREIGN_ORG = view('44444444-4444-4444-8444-444444444444', 'Globex desk', {
  shared: true,
  ownedByCaller: false,
  canModify: false,
  filters: { scope: 'all', organizationId: FOREIGN },
});

const VIEWS = [FULL, NO_SCOPE, ALL_SCOPE, FOREIGN_ORG];

function rfq(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    businessId: `RFQ-${n}`,
    organizationId: ACME,
    organizationName: 'Acme',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    customerDisplayName: 'Buyer',
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: false,
    lineCount: 2,
    totalAtCustomerPrice: 100 + n,
    totalAtAgreedPrice: null,
    currency: 'PLN',
    submittedAt: null,
    expiresAt: null,
    updatedAt: `2026-05-${String((n % 28) + 1).padStart(2, '0')}T12:00:00Z`,
    version: 1,
  };
}

/** Twenty-five rows: two pages at the stubbed size of 20. */
const ROWS = Array.from({ length: 25 }, (_, i) => rfq(i + 1));

/**
 * What the server answers since issue #317: the matching rows newest change
 * first, cut to the page asked for, with the total.
 */
function serverPage<T extends { updatedAt: string; id: string }>(path: string, matching: readonly T[]) {
  const params = new URLSearchParams(path.split('?')[1]);
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const ordered = [...matching].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id),
  );
  return {
    data: ordered.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: matching.length,
      limit: pageSize,
      hasMore: page * pageSize < matching.length,
      nextCursor: null,
    },
  };
}

let nativeDialogs: {
  prompt: ReturnType<typeof vi.spyOn>;
  confirm: ReturnType<typeof vi.spyOn>;
  alert: ReturnType<typeof vi.spyOn>;
};

beforeEach(() => {
  auth.role = 'platform_admin';
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith(ENDPOINT)) return { data: VIEWS };
    if (path.startsWith(LIST)) {
      // The server narrows to the loader's organizations: a foreign one answers nothing.
      return serverPage(path, path.includes(FOREIGN) ? [] : ROWS);
    }
    if (path.startsWith(ORGANIZATIONS)) {
      // Only a request naming the foreign organization could learn its name.
      if (path.includes(FOREIGN)) {
        return {
          data: [{ id: FOREIGN, name: FOREIGN_NAME, legalName: null, status: 'active', version: 1 }],
          pagination: { cursor: null, hasMore: false, limit: 25 },
        };
      }
      return {
        data: [{ id: ACME, name: 'Acme', legalName: null, status: 'active', version: 1 }],
        pagination: { cursor: null, hasMore: false, limit: 25 },
      };
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
      <MemoryRouter>
        <RfqList />
      </MemoryRouter>
    </StrictMode>,
    { core: en as Record<string, string> },
  );
  await screen.findByText('#RFQ-25');
  // StrictMode requests the views twice; only the option proves they arrived.
  await screen.findByRole('option', { name: FULL.name });
  return user;
}

function savedViewsSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;
}

function sortSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement;
}

function searchBox(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Search' }) as HTMLInputElement;
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

function listRequests(): URLSearchParams[] {
  return api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(LIST.length)));
}

function getPaths(): string[] {
  return api.get.mock.calls.map(([path]) => path).filter((path): path is string => typeof path === 'string');
}

describe('RfqList — saved views (feature 147, #290)', () => {
  it("mounts the kit's control against the quote request list's endpoint", async () => {
    await renderList();
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
    const options = within(savedViewsSelect())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      '— Select a view —',
      'Pending Acme',
      'Approved',
      'Everything (shared)',
      'Globex desk (shared)',
    ]);
    expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeDisabled();
  });

  it('saves scope, organization, status, search, sort and columns (US3-1)', async () => {
    const user = await renderList();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Visibility'), 'unassigned');
    await user.click(screen.getByRole('combobox', { name: 'Select organization' }));
    await user.click(await screen.findByRole('option', { name: /^Acme/ }));

    const statuses = await openMultiSelect(user, 'Status');
    await user.click(within(statuses).getByLabelText('Pending'));
    await user.type(searchBox(), '  acme ');
    await user.selectOptions(sortSelect(), 'total:desc');
    const columns = await openMultiSelect(user, 'Columns');
    await user.click(within(columns).getByLabelText('Lines'));
    await user.click(within(columns).getByLabelText('Updated'));

    const body = (await saveAs(user, '  Mine  ')) as Record<string, unknown>;
    expect(body['name']).toBe('Mine');
    expect(body['shared']).toBe(false);
    expect(body['filters']).toEqual({ scope: 'unassigned', organizationId: ACME, status: ['Pending'], q: 'acme' });
    expect(body['sort']).toEqual({ field: 'total', dir: 'desc' });
    expect([...(body['visibleColumns'] as string[])].sort()).toEqual(
      ['rfq', 'updated', 'org', 'customer', 'status', 'total'].sort(),
    );
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves the scope alone when every other filter is at its default', async () => {
    const user = await renderList();
    expect(await saveAs(user, 'Defaults')).toEqual({
      name: 'Defaults',
      shared: false,
      filters: { scope: 'all' },
      sort: { field: 'updatedAt', dir: 'desc' },
      visibleColumns: DEFAULT_COLUMNS,
    });
  });

  it('loading a view replaces all six parts and the next list request carries its scope and organization (US3-2)', async () => {
    const user = await renderList();

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), FULL.id);

    expect(sortSelect().value).toBe('total:desc');
    expect(searchBox().value).toBe('acme');
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    const next = listRequests()[before]!;
    expect(next.get('assignmentScope')).toBe('unassigned');
    expect(next.get('organizationId')).toBe(ACME);

    // The unknown status, the unknown key and the unknown column id are dropped (FR-012).
    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: { scope: 'unassigned', organizationId: ACME, status: ['Pending'], q: 'acme' },
      sort: { field: 'total', dir: 'desc' },
      visibleColumns: ['rfq', 'total'],
    });
  });

  it('a view without a scope loads all for a platform admin, an unknown sort as newest, empty columns as the defaults', async () => {
    const user = await renderList();
    await user.selectOptions(savedViewsSelect(), FULL.id);
    await waitFor(() => expect(listRequests().some((p) => p.get('assignmentScope') === 'unassigned')).toBe(true));

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), NO_SCOPE.id);

    expect(sortSelect().value).toBe('updatedAt:desc');
    expect(searchBox().value).toBe('');
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    const next = listRequests()[before]!;
    expect(next.get('assignmentScope')).toBe('all');
    expect(next.get('organizationId')).toBeNull();

    expect(await saveAs(user, 'Copy')).toEqual({
      name: 'Copy',
      shared: false,
      filters: { scope: 'all', status: ['Approved'] },
      sort: { field: 'updatedAt', dir: 'desc' },
      visibleColumns: DEFAULT_COLUMNS,
    });
  });

  it('a view without a scope loads mine for anyone but a platform admin (FR-016)', async () => {
    auth.role = 'sales_representative';
    const user = await renderList();
    await user.selectOptions(savedViewsSelect(), FULL.id);
    await waitFor(() => expect(listRequests().some((p) => p.get('assignmentScope') === 'unassigned')).toBe(true));

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), NO_SCOPE.id);

    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    expect(listRequests()[before]!.get('assignmentScope')).toBe('mine');
    const body = (await saveAs(user, 'Copy')) as Record<string, unknown>;
    expect(body['filters']).toEqual({ scope: 'mine', status: ['Approved'] });
  });

  it('loading a view returns the list to its first page (FR-011)', async () => {
    const user = await renderList();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();

    await user.selectOptions(savedViewsSelect(), ALL_SCOPE.id);

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Page 2 of 2')).toBeNull();
  });

  it('a view naming an organization outside the loader\'s scope never discloses its name (FR-017)', async () => {
    const user = await renderList();

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), FOREIGN_ORG.id);
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    // The loader's own request: the server narrows it, and it answers nothing.
    expect(listRequests()[before]!.get('organizationId')).toBe(FOREIGN);
    expect(await screen.findByText('No Quote Requests match the current filter.')).toBeInTheDocument();

    // Open the advanced filters so the organization picker mounts and queries.
    const organizationCalls = getPaths().filter((p) => p.startsWith(ORGANIZATIONS)).length;
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await waitFor(() =>
      expect(getPaths().filter((p) => p.startsWith(ORGANIZATIONS)).length).toBeGreaterThan(organizationCalls),
    );
    await user.click(screen.getByRole('combobox', { name: 'Select organization' }));
    await screen.findByRole('option', { name: /^Acme/ });

    expect(document.body.textContent ?? '').not.toContain(FOREIGN_NAME);
    for (const path of getPaths().filter((p) => p.startsWith(ORGANIZATIONS))) {
      expect(path).not.toContain(FOREIGN);
    }
  });
});
