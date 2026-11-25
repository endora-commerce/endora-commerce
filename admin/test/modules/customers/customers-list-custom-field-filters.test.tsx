import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1903 — custom fields as filters of the Customers list, the kit's
 * `CustomFieldListFilters` as the Orders, Quote Requests, Projects and Tasks
 * lists render them: the fields come from `GET /customers/custom-field-filters`,
 * behind *More filters*, and only for a reader who may view custom fields
 * (`custom_fields:read`).
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { CustomersList, customersListPath } = await import('../../../../packages/modules/customers/src/admin/pages/CustomersList');

const en = { ...shippedCoreBundle('en'), ...shippedModuleBundle('customers', 'en') };
const core = en.core!;

const LIST_PATH = '/api/v1/admin/customers';
const OFFERED_PATH = '/api/v1/admin/customers/custom-field-filters';

const TIER: CustomFieldListFilterField = {
  key: 'tier',
  valueType: 'select',
  label: { en: 'Tier' },
  labelDefault: 'Tier',
  options: [
    { value: 'gold', label: { en: 'Gold' }, labelDefault: 'Gold' },
    { value: 'silver', label: { en: 'Silver' }, labelDefault: 'Silver' },
  ],
};

const customer = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'buyer1@example.com',
  firstName: 'Buyer',
  lastName: 'One',
  organizationId: null,
  organizationName: null,
  customerGroupId: null,
  customerGroupName: null,
  blocked: false,
  deleted: false,
  createdAt: '2026-05-01T09:00:00.000Z',
  lastLoginAt: null,
};

let listAnswer: (query: URLSearchParams) => Promise<unknown>;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  listAnswer = async () => ({ data: [customer], meta: { page: 1, pageSize: 20, total: 1 } });
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: [TIER] });
    if (path.startsWith(`${LIST_PATH}?`)) return listAnswer(new URLSearchParams(path.split('?')[1] ?? ''));
    if (path.startsWith('/api/v1/admin/organizations')) {
      return Promise.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0 }, pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
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
      <MemoryRouter>
        <CustomersList />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    en,
  );
  await screen.findByRole('link', { name: 'Buyer One' });
}

async function openMoreFilters(): Promise<void> {
  const toggle = await screen.findByRole('button', { name: /^More filters/ });
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle);
}

async function chooseGold(): Promise<void> {
  await openMoreFilters();
  fireEvent.click(await screen.findByRole('button', { name: 'Tier' }));
  fireEvent.click(screen.getByLabelText('Gold'));
}

describe('customersListPath — custom-field filters', () => {
  it('sends the filters as customFieldFilters JSON when any is set', () => {
    expect(
      customersListPath({
        status: '',
        q: '',
        organizationId: null,
        page: 1,
        pageSize: 20,
        customFieldFilters: '{"tier":{"in":["gold"]}}',
      }),
    ).toBe(`/api/v1/admin/customers?customFieldFilters=${encodeURIComponent('{"tier":{"in":["gold"]}}')}&page=1&pageSize=20`);
  });
});

describe('CustomersList — custom-field filters (#1903)', () => {
  it('offers the fields marked as list filters, to a reader who may view custom fields', async () => {
    await renderList();
    await openMoreFilters();
    expect(await screen.findByRole('button', { name: 'Tier' })).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith(OFFERED_PATH);
    expect(lastQuery().has('customFieldFilters')).toBe(false);
  });

  it('sends a choice as customFieldFilters and starts again from the first page', async () => {
    await renderList();
    await chooseGold();
    await waitFor(() =>
      expect(JSON.parse(lastQuery().get('customFieldFilters') ?? 'null')).toEqual({ tier: { in: ['gold'] } }),
    );
    expect(lastQuery().get('page')).toBe('1');
  });

  it('clearing the filters clears the custom-field ones too', async () => {
    await renderList();
    await chooseGold();
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(true));
    await userEvent.click(screen.getAllByRole('button', { name: core['common.listToolbar.clearAll']! })[0]!);
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
  });

  it('says which filter the server no longer offers, and removes it on request', async () => {
    listAnswer = async (query) =>
      query.has('customFieldFilters')
        ? Promise.reject(
            new ApiError(400, {
              error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE', message: 'The filter is not available.', details: { key: 'tier' } },
            }),
          )
        : { data: [customer], meta: { page: 1, pageSize: 20, total: 1 } };
    await renderList();
    await chooseGold();
    expect(
      await screen.findByText(core['customFieldFilters.error.unavailable']!.replace('{field}', 'Tier')),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core['customFieldFilters.error.remove']! }));
    await waitFor(() => expect(lastQuery().has('customFieldFilters')).toBe(false));
    expect(await screen.findByRole('link', { name: 'Buyer One' })).toBeInTheDocument();
  });

  it('offers nothing, and asks for nothing, without custom_fields:read', async () => {
    await renderList(['customers:read']);
    expect(screen.queryByRole('button', { name: /^More filters/ })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(OFFERED_PATH);
  });
});
