import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1903 — custom fields as filters of the Organizations list, the kit's
 * `CustomFieldListFilters` as the Orders, Quote Requests, Projects and Tasks
 * lists render them: the fields come from
 * `GET /organizations/custom-field-filters`, behind *More filters*, and only
 * for a reader who may view custom fields (`custom_fields:read`).
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OrganizationsList, organizationsListPath } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationsList'
);

const en = { ...shippedCoreBundle('en'), ...shippedModuleBundle('organizations', 'en') };
const core = en.core!;

const LIST_PATH = '/api/v1/admin/organizations';
const OFFERED_PATH = '/api/v1/admin/organizations/custom-field-filters';

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

const org = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Firma 1',
  taxId: 'PL0000000001',
  isPersonal: false,
  status: 'active',
  vatStatus: 'vat_payer',
  createdAt: '2026-05-01T09:00:00.000Z',
};

let listAnswer: (query: URLSearchParams) => Promise<unknown>;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  listAnswer = async () => ({
    data: [org],
    meta: { page: 1, pageSize: 20, total: 1 },
    pagination: { cursor: null, hasMore: false, limit: 20 },
  });
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: [SEGMENT] });
    if (path.startsWith(`${LIST_PATH}?`)) return listAnswer(new URLSearchParams(path.split('?')[1] ?? ''));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});
afterEach(() => cleanup());

const listQueries = (): URLSearchParams[] =>
  getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path.startsWith(`${LIST_PATH}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
const lastQuery = (): URLSearchParams => listQueries().at(-1)!;

const CAN_FILTER = ['customers:read', 'custom_fields:read'];

async function renderList(permissions: string[] = CAN_FILTER): Promise<void> {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/organizations']}>
        <Routes>
          <Route path="/organizations" element={<OrganizationsList />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    en,
    { language: 'en' },
  );
  await screen.findByRole('link', { name: 'Firma 1' });
}

async function openMoreFilters(): Promise<void> {
  const toggle = await screen.findByRole('button', { name: /^More filters/ });
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle);
}

async function chooseSmb(): Promise<void> {
  await openMoreFilters();
  fireEvent.click(await screen.findByRole('button', { name: 'Segment' }));
  fireEvent.click(screen.getByLabelText('Small business'));
}

describe('organizationsListPath — custom-field filters', () => {
  it('sends the filters as customFieldFilters JSON when any is set', () => {
    expect(
      organizationsListPath({ status: '', q: '', page: 1, pageSize: 20, customFieldFilters: '{"segment":{"in":["smb"]}}' }),
    ).toBe(`/api/v1/admin/organizations?customFieldFilters=${encodeURIComponent('{"segment":{"in":["smb"]}}')}&page=1&pageSize=20`);
  });
});

describe('OrganizationsList — custom-field filters (#1903)', () => {
  it('offers the fields marked as list filters, to a reader who may view custom fields', async () => {
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
    expect(lastQuery().get('page')).toBe('1');
  });

  it('clearing the filters clears the custom-field ones too', async () => {
    await renderList();
    await chooseSmb();
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(true));
    await userEvent.click(screen.getAllByRole('button', { name: core['common.listToolbar.clearAll']! })[0]!);
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
  });

  it('says which filter the server no longer offers, and removes it on request', async () => {
    listAnswer = async (query) =>
      query.has('customFieldFilters')
        ? Promise.reject(
            new ApiError(400, {
              error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE', message: 'The filter is not available.', details: { key: 'segment' } },
            }),
          )
        : { data: [org], meta: { page: 1, pageSize: 20, total: 1 }, pagination: { cursor: null, hasMore: false, limit: 20 } };
    await renderList();
    await chooseSmb();
    expect(
      await screen.findByText(core['customFieldFilters.error.unavailable']!.replace('{field}', 'Segment')),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core['customFieldFilters.error.remove']! }));
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
    expect(await screen.findByRole('link', { name: 'Firma 1' })).toBeInTheDocument();
  });

  it('offers nothing, and asks for nothing, without custom_fields:read', async () => {
    await renderList(['customers:read']);
    expect(screen.queryByRole('button', { name: /^More filters/ })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(OFFERED_PATH);
  });
});
