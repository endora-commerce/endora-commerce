import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import catalog from '../../../../packages/modules/catalog/i18n/en.json';

/**
 * Feature 147 (T036, US2; FR-008 – FR-012) — saved views on the product list
 * (closes #289). The page owns only the mapping between its state and a
 * `SavedViewState`: a view stores status, type and search, nothing else; the
 * Stock, Category and Channel chips are not saved, and loading a view returns
 * Stock to *All*, the list to its first page and drops the row selection. The
 * control's own behaviour is `admin/test/components/SavedViewsControl*.test.tsx`.
 *
 * Both bundles are the real ones: the control is named by `core`'s
 * `savedViews.*` copy and the page by `catalog`'s, and a passthrough would
 * hide a missing key.
 */

const ENDPOINT = '/api/v1/admin/catalog/products/list-views';
const LIST = '/api/v1/admin/catalog/products?';

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

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const OWNER = '00000000-0000-4000-8000-0000000000b1';

function view(id: string, name: string, filters: Record<string, unknown>): SavedListView {
  return { id, name, shared: false, ownerAdminUserId: OWNER, ownedByCaller: true, canModify: true, filters };
}

const INACTIVE_CHAIRS = view('11111111-1111-4111-8111-111111111111', 'Inactive chairs', {
  status: 'inactive',
  type: 'configurable',
  q: 'chair',
});
/** Values the page no longer offers, and a key it never knew. */
const STALE = view('22222222-2222-4222-8222-222222222222', 'Stale', {
  status: 'archived',
  type: 'kit',
  colour: 'red',
});

/**
 * Feature 163 (FR-010, R30.4) — a view saved before `draft` was removed. It opens as
 * *All*, as any value the page no longer offers does; owner decision P-2 → A
 * (2026-10-26) keeps that rather than mapping it onto `inactive`, and the list says so
 * once, when the view is applied.
 */
const LEGACY_DRAFT = view('44444444-4444-4444-8444-444444444444', 'Legacy drafts', { status: 'draft' });
/** Feature 163 — the Archived tab is saved as its own key, never as a status. */
const ARCHIVED = view('55555555-5555-4555-8555-555555555555', 'Archived', { archived: 'only' });

const VIEWS = [INACTIVE_CHAIRS, STALE, LEGACY_DRAFT, ARCHIVED];

function product(id: string, name: string): unknown {
  return {
    id,
    sku: `SKU-${id.slice(-4)}`,
    slug: name.toLowerCase().replace(/\s/g, '-'),
    type: 'simple',
    status: 'active',
    name,
    visibility: 'public',
    attributeValues: {},
    updatedAt: '2026-05-15T10:00:00.000Z',
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
    if (path.startsWith(ENDPOINT)) return { data: VIEWS };
    if (path.startsWith(LIST)) {
      // Two rows of sixty: enough for a second page at the stubbed size of 20.
      return {
        data: [
          product('00000000-0000-4000-8000-000000000c01', 'Oak chair'),
          product('00000000-0000-4000-8000-000000000c02', 'Pine desk'),
        ],
        pagination: { page: 0, pageSize: 20, total: 60 },
        counts: { all: 60, active: 40, inactive: 20, archived: 5 },
      };
    }
    return { data: [] };
  });
  api.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({
    data: view('33333333-3333-4333-8333-333333333333', String(body['name']), {}),
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
          <ProductsList />
        </MemoryRouter>,
        // US2-4: the list's own read code is all a saved view needs.
        { session: adminSession({ permissions: ['catalog:read'] }) },
      )}
    </StrictMode>,
    { core: core as Record<string, string>, catalog: catalog as Record<string, string> },
  );
  await screen.findByText('Oak chair');
  // StrictMode requests the views twice; only the option proves they arrived.
  await screen.findByRole('option', { name: INACTIVE_CHAIRS.name });
  return user;
}

function savedViewsSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;
}

function searchBox(): HTMLInputElement {
  return screen.getByPlaceholderText('Search SKU, slug, name…') as HTMLInputElement;
}

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(`^${name}`) });
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

function listRequests(): string[] {
  return api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST));
}

/** Waits until the debounced search for `q` has reached the list endpoint. */
async function waitForSearch(q: string): Promise<void> {
  await waitFor(() =>
    expect(listRequests().some((p) => new URLSearchParams(p.slice(LIST.length)).get('q') === q)).toBe(true),
  );
}

describe('ProductsList — saved views (feature 147, #289)', () => {
  it("mounts the kit's control against the product list's endpoint for a catalog:read admin", async () => {
    await renderList();
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
    const options = within(savedViewsSelect())
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['— Select a view —', 'Inactive chairs', 'Stale', 'Legacy drafts', 'Archived']);
    expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete view' })).toBeDisabled();
  });

  it('saves status, type and search, and nothing for stock', async () => {
    const user = await renderList();

    await user.click(tab('Inactive'));
    await user.click(screen.getByRole('button', { name: 'Type' }));
    await user.click(screen.getByRole('button', { name: 'Type: simple' }));
    await user.type(searchBox(), '  chair ');
    await user.click(screen.getByRole('button', { name: 'Stock' }));
    expect(screen.getByRole('button', { name: 'Low stock' })).toBeInTheDocument();

    const body = (await saveAs(user, 'Mine')) as Record<string, unknown>;
    expect(body['name']).toBe('Mine');
    expect(body['shared']).toBe(false);
    expect(body['filters']).toEqual({ status: 'inactive', type: 'configurable', q: 'chair' });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves no filters at all when every control is at its default', async () => {
    const user = await renderList();
    const body = (await saveAs(user, 'Everything')) as Record<string, unknown>;
    expect(body['filters']).toEqual({});
  });

  it('loading a view replaces status, type and search, returns Stock to All and the list to its first page', async () => {
    const user = await renderList();

    await user.type(searchBox(), 'desk');
    // Let the typed search's own debounced request land first: left pending, it
    // fires whenever the runner is slow enough and would sit where the load's
    // request is expected, attributing the typing's request to the load.
    await waitForSearch('desk');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() =>
      expect(listRequests().some((p) => p.includes('q=desk') && p.includes('page=1'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Stock' }));
    expect(screen.getByRole('button', { name: 'Low stock' })).toBeInTheDocument();

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), INACTIVE_CHAIRS.id);

    expect(tab('Inactive')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Type: configurable' })).toBeInTheDocument();
    expect(searchBox().value).toBe('chair');
    expect(screen.getByRole('button', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Low stock' })).toBeNull();

    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    // FR-011: the very next list request already carries the first page.
    const next = new URLSearchParams(listRequests()[before]!.slice(LIST.length));
    expect(next.get('status')).toBe('inactive');
    expect(next.get('type')).toBe('configurable');
    expect(next.get('q')).toBe('chair');
    expect(next.get('page')).toBe('0');
    for (const path of listRequests().slice(before)) {
      expect(new URLSearchParams(path.slice(LIST.length)).get('page')).toBe('0');
    }
  });

  it('loading a view clears the row selection', async () => {
    const user = await renderList();

    const rowCheckbox = screen.getAllByRole('checkbox')[1]!;
    await user.click(rowCheckbox);
    expect(await screen.findByTestId('selection-summary')).toBeInTheDocument();

    await user.selectOptions(savedViewsSelect(), INACTIVE_CHAIRS.id);
    await waitFor(() => expect(screen.queryByTestId('selection-summary')).toBeNull());
  });

  it('a view with values the page does not know loads as All / All without error', async () => {
    const user = await renderList();

    await user.click(tab('Active'));
    await user.click(screen.getByRole('button', { name: 'Type' }));
    await user.type(searchBox(), 'desk');
    await waitForSearch('desk');

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), STALE.id);

    expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Type' })).toBeInTheDocument();
    expect(searchBox().value).toBe('');
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    const next = new URLSearchParams(listRequests()[before]!.slice(LIST.length));
    expect(next.get('status')).toBeNull();
    expect(next.get('type')).toBeNull();
    expect(next.get('q')).toBeNull();
    expect(screen.queryByText('Failed to load.')).toBeNull();

    // Neither the stale values nor the unknown key survive into the next save.
    const body = (await saveAs(user, 'Copy')) as Record<string, unknown>;
    expect(body['filters']).toEqual({});
  });

  it('a view saved with the removed draft status opens as All and never sends draft (feature 163)', async () => {
    const user = await renderList();
    await user.click(tab('Active'));

    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), LEGACY_DRAFT.id);

    expect(tab('All')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    for (const path of listRequests().slice(before)) {
      const params = new URLSearchParams(path.slice(LIST.length));
      expect(params.get('status')).toBeNull();
      expect(params.get('archived')).toBeNull();
    }
    expect(screen.queryByText('Failed to load.')).toBeNull();
  });

  it('says once that a draft view now shows all products, until a tab is chosen or it is dismissed (P-2)', async () => {
    const user = await renderList();
    const note = (catalog as Record<string, string>)['productsList.savedView.draftRemoved']!;
    expect(screen.queryByText(note)).toBeNull();

    await user.selectOptions(savedViewsSelect(), LEGACY_DRAFT.id);
    const shown = await screen.findByText(note);
    expect(shown.closest('[role="status"]')).not.toBeNull();

    await user.click(tab('Inactive'));
    expect(screen.queryByText(note)).toBeNull();

    await user.selectOptions(savedViewsSelect(), INACTIVE_CHAIRS.id);
    expect(screen.queryByText(note)).toBeNull();
    await user.selectOptions(savedViewsSelect(), LEGACY_DRAFT.id);
    await screen.findByText(note);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(note)).toBeNull();
  });

  it('saves the Archived tab as archived: only, and a view holding it opens the Archived tab (feature 163)', async () => {
    const user = await renderList();

    await user.click(tab('Archived'));
    const body = (await saveAs(user, 'Gone')) as Record<string, unknown>;
    expect(body['filters']).toEqual({ archived: 'only' });

    await user.click(tab('All'));
    const before = listRequests().length;
    await user.selectOptions(savedViewsSelect(), ARCHIVED.id);
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(listRequests().length).toBeGreaterThan(before));
    const next = new URLSearchParams(listRequests()[before]!.slice(LIST.length));
    expect(next.get('archived')).toBe('only');
    expect(next.get('status')).toBeNull();
  });
});
