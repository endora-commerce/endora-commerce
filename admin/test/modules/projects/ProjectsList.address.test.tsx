import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Route, useLocation, useNavigate } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { ADMIN_ID, ORGANIZATION_ID, ROLES, ROLE_MANAGER, en, renderProjects, summary } from './projects-fixtures';

/**
 * The Projects list keeps its filters in the address (issue #454).
 *
 * Back, a reload and a shared link all keep the filters, and another screen
 * can link to a pre-filtered list (the Organization screen's *All projects*,
 * `/projects?organizationId=…`). A parameter the list does not take is
 * ignored, never sent; a Role or Template the screen's choices no longer hold
 * is dropped once they are read.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProjectsList } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectsList');

const LIST_PATH = '/api/v1/admin/projects';
const TEMPLATE_ID = '00000000-0000-4000-8000-0000000007a1';
const GONE_ID = '00000000-0000-4000-8000-0000000009ff';
const FAR_ADMIN_ID = '00000000-0000-4000-8000-000000000c09';
const FAR_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a9';

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({ items: [summary()], nextCursor: null, total: 1 });
    }
    if (path === `${LIST_PATH}/roles`) return Promise.resolve({ data: ROLES });
    if (path === `${LIST_PATH}/templates`) {
      return Promise.resolve({
        data: [{ id: TEMPLATE_ID, name: 'Showroom fit-out', stageCount: 3, archivedAt: null, updatedAt: '2026-10-21T10:00:00.000Z' }],
      });
    }
    if (path === `${LIST_PATH}/lookups/organizations?id=${FAR_ORGANIZATION_ID}`) {
      return Promise.resolve({ data: [{ id: FAR_ORGANIZATION_ID, name: 'Faraway Ltd' }] });
    }
    if (path.startsWith(`${LIST_PATH}/lookups/organizations`)) {
      return Promise.resolve({ data: [{ id: ORGANIZATION_ID, name: 'Acme' }] });
    }
    if (path === `${LIST_PATH}/lookups/admin-users?id=${FAR_ADMIN_ID}`) {
      return Promise.resolve({ data: [{ id: FAR_ADMIN_ID, name: 'Zofia Far', email: 'zofia@example.com' }] });
    }
    if (path.startsWith(`${LIST_PATH}/lookups/admin-users`)) {
      return Promise.resolve({ data: [{ id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function listQueries(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

const lastQuery = (): URLSearchParams => listQueries().at(-1) ?? new URLSearchParams();

/** The address the router is at, for the assertions. */
function Address(): ReactElement {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

const address = (): URLSearchParams => new URLSearchParams(screen.getByTestId('address').textContent ?? '');

/** A Project's screen, standing in for the real one: it only goes back. */
function Elsewhere(): ReactElement {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={(): void => void navigate(-1)}>
      Go back
    </button>
  );
}

async function renderAt(path: string): Promise<ReturnType<typeof renderProjects>> {
  const rendered = renderProjects(
    <>
      <ProjectsList />
      <Address />
    </>,
    {
      path,
      pattern: '/projects',
      routes: <Route path="/projects/:projectId" element={<Elsewhere />} />,
    },
  );
  await screen.findByText('Warehouse fit-out');
  return rendered;
}

describe('ProjectsList — filters in the address', () => {
  it('opens a shared link with its filters applied and shown', async () => {
    await renderAt(
      `/projects?state=completed&organizationId=${FAR_ORGANIZATION_ID}&memberId=${FAR_ADMIN_ID}` +
        `&roleId=${ROLE_MANAGER}&templateId=${TEMPLATE_ID}&stageName=Build&q=PRJ-7&sort=value&order=asc`,
    );
    const first = listQueries()[0] as URLSearchParams;
    expect(first.getAll('state')).toEqual(['completed']);
    expect(first.get('organizationId')).toBe(FAR_ORGANIZATION_ID);
    expect(first.get('memberId')).toBe(FAR_ADMIN_ID);
    expect(first.get('roleId')).toBe(ROLE_MANAGER);
    expect(first.get('templateId')).toBe(TEMPLATE_ID);
    expect(first.get('stageName')).toBe('Build');
    expect(first.get('q')).toBe('PRJ-7');
    expect(first.get('sort')).toBe('value');
    expect(first.get('order')).toBe('asc');

    expect(screen.getByLabelText(en('list.filter.state'))).toHaveValue('completed');
    expect(screen.getByLabelText(en('list.search'))).toHaveValue('PRJ-7');
    expect(screen.getByLabelText(en('list.filter.stageName'))).toHaveValue('Build');
    expect(screen.getByLabelText(en('list.sort'))).toHaveValue('value:asc');
    await waitFor(() => expect(screen.getByLabelText(en('list.filter.role'))).toHaveValue(ROLE_MANAGER));
    await waitFor(() => expect(screen.getByLabelText(en('list.filter.template'))).toHaveValue(TEMPLATE_ID));
    // A member and an Organization the first lookup page does not hold are named by their id.
    await waitFor(() => expect(screen.getByRole('combobox', { name: en('list.filter.member') })).toHaveValue('Zofia Far'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: en('list.filter.organization') })).toHaveValue('Faraway Ltd'),
    );
  });

  it('opens the Organization screen’s link narrowed to that Organization', async () => {
    await renderAt(`/projects?organizationId=${ORGANIZATION_ID}`);
    expect(listQueries()[0]?.get('organizationId')).toBe(ORGANIZATION_ID);
    await waitFor(() => expect(screen.getByRole('combobox', { name: en('list.filter.organization') })).toHaveValue('Acme'));
    expect(screen.getByRole('button', { name: en('list.filter.clear') })).toBeTruthy();
  });

  it('writes each filter into the address under the name the API takes', async () => {
    await renderAt('/projects');
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.state')), 'lost');
    await waitFor(() => expect(address().get('state')).toBe('lost'));

    await userEvent.click(screen.getByLabelText(en('list.filter.mine')));
    await waitFor(() => expect(address().get('memberId')).toBe('me'));

    await userEvent.type(screen.getByLabelText(en('list.search')), 'Hall');
    await waitFor(() => expect(address().get('q')).toBe('Hall'));

    await userEvent.selectOptions(screen.getByLabelText(en('list.sort')), 'deadline:desc');
    await waitFor(() => {
      expect(address().get('sort')).toBe('deadline');
      expect(address().get('order')).toBe('desc');
    });
    expect(lastQuery().get('q')).toBe('Hall');

    await userEvent.click(screen.getByRole('button', { name: en('list.filter.clear') }));
    await waitFor(() => expect(address().has('state')).toBe(false));
    expect(['q', 'memberId'].filter((key) => address().has(key))).toEqual([]);
    expect(screen.getByLabelText(en('list.search'))).toHaveValue('');
  });

  it('keeps the filters when the operator opens a Project and comes Back', async () => {
    await renderAt('/projects');
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.state')), 'completed');
    await userEvent.type(screen.getByLabelText(en('list.filter.stageName')), 'Build');
    await waitFor(() => expect(address().get('stageName')).toBe('Build'));

    await userEvent.click(screen.getByRole('link', { name: 'PRJ-000001' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    await screen.findByText('Warehouse fit-out');

    expect(screen.getByLabelText(en('list.filter.state'))).toHaveValue('completed');
    expect(screen.getByLabelText(en('list.filter.stageName'))).toHaveValue('Build');
    expect(lastQuery().getAll('state')).toEqual(['completed']);
    expect(lastQuery().get('stageName')).toBe('Build');
  });

  it('keeps the filters over a reload', async () => {
    const first = await renderAt('/projects');
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.state')), 'open');
    await waitFor(() => expect(address().get('state')).toBe('open'));
    const reloaded = `/projects?${address().toString()}`;
    first.unmount();
    getSpy.mockClear();

    await renderAt(reloaded);
    expect(listQueries()[0]?.getAll('state')).toEqual(['open']);
    expect(screen.getByLabelText(en('list.filter.state'))).toHaveValue('open');
  });

  it('ignores what the address carries that the list does not take', async () => {
    await renderAt(
      '/projects?state=archived&organizationId=acme&memberId=someone&roleId=1&templateId=x&sort=title&order=up&cursor=abc',
    );
    const first = listQueries()[0] as URLSearchParams;
    for (const key of ['state', 'organizationId', 'memberId', 'roleId', 'templateId', 'cursor']) {
      expect(first.has(key)).toBe(false);
    }
    expect(first.get('sort')).toBe('createdAt');
    expect(first.get('order')).toBe('desc');
    expect(screen.queryByRole('button', { name: en('list.filter.clear') })).toBeNull();
  });

  it('drops a Role or Template the choices no longer hold, once they are read', async () => {
    await renderAt(`/projects?roleId=${GONE_ID}&templateId=${GONE_ID}&state=open`);
    await waitFor(() => {
      expect(address().has('roleId')).toBe(false);
      expect(address().has('templateId')).toBe(false);
    });
    expect(address().get('state')).toBe('open');
    await waitFor(() => {
      expect(lastQuery().has('roleId')).toBe(false);
      expect(lastQuery().has('templateId')).toBe(false);
    });
  });
});
