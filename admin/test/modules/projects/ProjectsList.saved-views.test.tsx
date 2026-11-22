import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import type { SavedListView } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ROLES, renderProjects, summary } from './projects-fixtures';

/**
 * Issue #1734 — saved views on the Projects list, through the kit's control
 * (feature 147). The page owns only the mapping: *Save view* stores the
 * address's filters and its sort; choosing a view replaces every filter and
 * the sort in the address, and what the list no longer takes is dropped.
 * The control's own behaviour is `admin/test/components/SavedViewsControl*.test.tsx`.
 */

const LIST_PATH = '/api/v1/admin/projects';
const ENDPOINT = '/api/v1/admin/projects/list-views';
const OWNER = '00000000-0000-4000-8000-0000000000b1';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

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
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProjectsList } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectsList');

const MINE_COMPLETED: SavedListView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'My completed',
  shared: true,
  ownerAdminUserId: OWNER,
  ownedByCaller: true,
  canModify: true,
  // `colour` is no filter the list has.
  filters: { state: 'completed', memberId: 'me', stageName: 'Build', colour: 'red', q: 'PRJ' },
  sort: { field: 'deadline', dir: 'asc' },
};

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === ENDPOINT) return Promise.resolve({ data: [MINE_COMPLETED] });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({ items: [summary()], nextCursor: null, total: 1 });
    }
    if (path === `${LIST_PATH}/roles`) return Promise.resolve({ data: ROLES });
    if (path === `${LIST_PATH}/templates`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${LIST_PATH}/lookups/`)) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  api.post.mockImplementation((_path: string, body: Record<string, unknown>) =>
    Promise.resolve({ data: { ...MINE_COMPLETED, id: '22222222-2222-4222-8222-222222222222', ...body } }),
  );
});

function Address(): ReactElement {
  return <output data-testid="address">{useLocation().search}</output>;
}

const address = (): URLSearchParams => new URLSearchParams(screen.getByTestId('address').textContent ?? '');

async function renderAt(path: string): Promise<void> {
  renderProjects(
    <>
      <ProjectsList />
      <Address />
    </>,
    { path, pattern: '/projects' },
  );
  await screen.findByText('Warehouse fit-out');
}

const savedViews = (): HTMLSelectElement => screen.getByRole('combobox', { name: 'Saved views' }) as HTMLSelectElement;

describe('ProjectsList — saved views (#1734)', () => {
  it('mounts the kit control against the Projects list endpoint', async () => {
    await renderAt('/projects');
    await waitFor(() => expect(within(savedViews()).getAllByRole('option')).toHaveLength(2));
    expect(api.get).toHaveBeenCalledWith(ENDPOINT);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves the filters and the sort the address carries', async () => {
    const user = userEvent.setup();
    await renderAt('/projects?state=open&memberId=me&stageName=Build&sort=value&order=asc');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Open of mine{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(ENDPOINT);
    expect(body).toMatchObject({
      name: 'Open of mine',
      filters: { state: 'open', memberId: 'me', stageName: 'Build' },
      sort: { field: 'value', dir: 'asc' },
    });
  });

  it('applies a view: every filter and the sort replaced, what the list does not take dropped', async () => {
    const user = userEvent.setup();
    await renderAt('/projects?state=open&organizationId=00000000-0000-4000-8000-0000000000a1');
    await waitFor(() => expect(within(savedViews()).getAllByRole('option')).toHaveLength(2));
    await user.selectOptions(savedViews(), MINE_COMPLETED.id);
    await waitFor(() => expect(address().get('state')).toBe('completed'));
    expect(address().get('organizationId')).toBeNull();
    expect(address().get('memberId')).toBe('me');
    expect(address().get('stageName')).toBe('Build');
    expect(address().get('q')).toBe('PRJ');
    expect(address().get('colour')).toBeNull();
    expect(address().get('sort')).toBe('deadline');
    expect(address().get('order')).toBe('asc');
    // The search box shows the view's search, which the screen did not type.
    expect(screen.getByRole('searchbox', { name: /search/i })).toHaveValue('PRJ');
  });
});
