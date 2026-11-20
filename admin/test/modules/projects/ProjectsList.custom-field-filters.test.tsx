import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { EVERY_PROJECTS_PERMISSION, core, renderProjects, summary } from './projects-fixtures';

/**
 * Custom-field filters on the Projects list (`specs/163-projects-and-tasks/`,
 * User Story 9 — carry-over C11 of Phase 11): the backend takes
 * `customFieldFilters` on `GET /projects` and offers the fields at
 * `GET /projects/custom-field-filters`; the list shows one control per offered
 * field — the kit's `CustomFieldListFilters`, as the Quote Requests list does —
 * only to a reader who may view custom fields (`custom_fields:read`).
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { ProjectsList } = await import('../../../../packages/modules/projects/src/admin/pages/ProjectsList');

const LIST_PATH = '/api/v1/admin/projects';
const OFFERED_PATH = '/api/v1/admin/projects/custom-field-filters';

const SEGMENT: CustomFieldListFilterField = {
  key: 'segment',
  valueType: 'select',
  label: { en: 'Segment' },
  labelDefault: 'Segment',
  options: [
    { value: 'smb', label: { en: 'Small business' }, labelDefault: 'SMB' },
    { value: 'ent', label: { en: 'Enterprise' }, labelDefault: 'Enterprise' },
  ],
};

let listAnswer: (query: URLSearchParams) => Promise<unknown>;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  listAnswer = async () => ({ items: [summary()], nextCursor: null, total: 1 });
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: [SEGMENT] });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return listAnswer(new URLSearchParams(path.split('?')[1] ?? ''));
    }
    if (path === `${LIST_PATH}/roles` || path === `${LIST_PATH}/templates`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${LIST_PATH}/lookups/`)) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function listQueries(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

const lastQuery = (): URLSearchParams => listQueries().at(-1)!;

const CAN_FILTER = [...EVERY_PROJECTS_PERMISSION, 'custom_fields:read'];

async function renderList(permissions: readonly string[] = CAN_FILTER): Promise<void> {
  renderProjects(<ProjectsList />, { path: '/projects', permissions });
  await screen.findByText('Warehouse fit-out');
}

/** Opens the toolbar's *More filters* panel unless it is open (issue #1505: these filters are folded away). */
async function openMoreFilters(): Promise<void> {
  const toggle = screen.queryByRole('button', { name: /^(More filters|Więcej filtrów)/ });
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle);
}

async function chooseSmb(): Promise<void> {
  await openMoreFilters();
  fireEvent.click(await screen.findByRole('button', { name: 'Segment' }));
  fireEvent.click(screen.getByLabelText('Small business'));
}

describe('ProjectsList — custom-field filters', () => {
  it('offers the fields the module marks as list filters, to a reader who may view custom fields', async () => {
    await renderList();
    await openMoreFilters();
    expect(await screen.findByRole('button', { name: 'Segment' })).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith(OFFERED_PATH);
    expect(lastQuery().has('customFieldFilters')).toBe(false);
  });

  it('sends a choice as customFieldFilters and starts again from the first page', async () => {
    await renderList();
    await chooseSmb();
    await waitFor(() =>
      expect(JSON.parse(lastQuery().get('customFieldFilters') ?? 'null')).toEqual({ segment: { in: ['smb'] } }),
    );
    expect(lastQuery().has('cursor')).toBe(false);
  });

  it('clearing the filters clears the custom-field ones too', async () => {
    await renderList();
    await chooseSmb();
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(true));
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear all filters' })[0]!);
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
  });

  it('says which filter the server no longer offers, and removes it on request', async () => {
    listAnswer = async (query) =>
      query.has('customFieldFilters')
        ? Promise.reject(
            new ApiError(400, {
              error: {
                code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE',
                message: 'The filter is not available.',
                details: { key: 'segment' },
              },
            }),
          )
        : { items: [summary()], nextCursor: null, total: 1 };
    await renderList();
    await chooseSmb();
    expect(await screen.findByText(core('customFieldFilters.error.unavailable', { field: 'Segment' }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core('customFieldFilters.error.remove') }));
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
    expect(await screen.findByText('Warehouse fit-out')).toBeInTheDocument();
  });

  it('offers nothing, and asks for nothing, without custom_fields:read', async () => {
    await renderList(EVERY_PROJECTS_PERMISSION);
    await openMoreFilters();
    expect(screen.queryByRole('button', { name: 'Segment' })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(OFFERED_PATH);
  });
});
