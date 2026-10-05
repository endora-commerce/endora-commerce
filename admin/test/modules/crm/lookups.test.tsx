import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import {
  CHANNEL_ID,
  CONTACT_ID,
  FOREIGN_PICKER_ENDPOINTS,
  ORGANIZATION_ID,
  WORKFLOW,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  summary,
} from './crm-fixtures';

/**
 * The pickers of the CRM screens read CRM's own lookups
 * (`specs/143-crm-sales-opportunities/research.md` N-D4).
 *
 * The defect: a role holding `crm:read` + `orders:read` got 403 from the
 * Organization and Sales Channel pickers of the filter bar, because they read
 * `organizations`' and `sales_channels`' admin lists. Here every admin list of
 * another module **rejects as that role would be rejected**, and the screens
 * must work regardless — and must not have asked.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);
const { OpportunityCreatePage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityCreatePage'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const READ_ONLY = ['crm:read', 'orders:read'];

/** Lookups a test makes fail, by route. */
let failing: Set<string>;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  failing = new Set();
  getSpy.mockImplementation((path: string) => {
    if (FOREIGN_PICKER_ENDPOINTS.some((prefix) => path.startsWith(prefix))) {
      return Promise.reject(new Error(`403 — a CRM screen asked another module's list: ${path}`));
    }
    if (failing.has(path.split('?')[0] as string)) return Promise.reject(new Error('boom'));
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({
        data: [summary()],
        pagination: { cursor: null, hasMore: false, limit: 20 },
      });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/crm/tags') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: detail() });
});

function requested(): string[] {
  return getSpy.mock.calls.map(([path]) => path as string);
}

function foreignRequests(): string[] {
  return requested().filter((path) =>
    FOREIGN_PICKER_ENDPOINTS.some((prefix) => path.startsWith(prefix)),
  );
}

function lastListQuery(): URLSearchParams {
  const all = requested().filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`));
  return new URLSearchParams((all[all.length - 1] as string).split('?')[1] ?? '');
}

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

describe('the pickers of the CRM screens', () => {
  it('filters the list by organization and by sales channel for a role holding only crm:read and orders:read', async () => {
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities', permissions: READ_ONLY });
    await screen.findByText('Fleet renewal');

    await pick(en('opportunity.list.filter.organization'), 'Acme');
    await waitFor(() => expect(lastListQuery().get('organizationId')).toBe(ORGANIZATION_ID));

    await pick(en('opportunity.list.filter.salesChannel'), 'Wholesale');
    await waitFor(() => expect(lastListQuery().get('salesChannelId')).toBe(CHANNEL_ID));

    expect(requested()).toContain('/api/v1/admin/crm/lookups/sales-channels');
    expect(requested().some((path) => path.startsWith('/api/v1/admin/crm/lookups/organizations'))).toBe(true);
    expect(foreignRequests()).toEqual([]);
  });

  it('searches organizations on the server as the operator types', async () => {
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities', permissions: READ_ONLY });
    await screen.findByText('Fleet renewal');
    await userEvent.type(screen.getByLabelText(en('opportunity.list.filter.organization')), 'acm');
    await waitFor(() =>
      expect(requested()).toContain('/api/v1/admin/crm/lookups/organizations?q=acm'),
    );
    expect(await screen.findByRole('option', { name: /Acme/ })).toBeInTheDocument();
  });

  it('says so when a picker\'s list cannot be read, rather than offering nothing', async () => {
    failing.add('/api/v1/admin/crm/lookups/organizations');
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities', permissions: READ_ONLY });
    await screen.findByText('Fleet renewal');
    expect(await screen.findByText(en('opportunity.picker.loadError'))).toBeInTheDocument();
  });

  it('creates an opportunity without reading any other module\'s list', async () => {
    renderCrm(<OpportunityCreatePage />, {
      path: '/crm/opportunities/new',
      pattern: '/crm/opportunities/new',
      permissions: ['crm:read', 'crm:write', 'orders:read'],
    });
    await userEvent.type(screen.getByLabelText(en('opportunity.field.title'), { exact: false }), 'Fleet');

    // Nobody to choose until the Organization is.
    expect(screen.getByLabelText(en('opportunity.field.contact'))).toBeDisabled();
    await pick(en('opportunity.field.organization'), 'Acme');
    await pick(en('opportunity.field.contact'), 'Jan Kowalski');
    expect(requested()).toContain(
      `/api/v1/admin/crm/lookups/contacts?organizationId=${ORGANIZATION_ID}`,
    );
    await pick(en('opportunity.field.salesChannel'), 'Wholesale');

    // The currencies offered are the ones the sales channels sell in.
    const currency = screen.getByLabelText(en('opportunity.field.currency'), { exact: false });
    await waitFor(() => expect(currency.querySelector('option[value="EUR"]')).not.toBeNull());
    await userEvent.selectOptions(currency, 'EUR');

    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/crm/opportunities',
      expect.objectContaining({
        title: 'Fleet',
        organizationId: ORGANIZATION_ID,
        customerAccountId: CONTACT_ID,
        salesChannelId: CHANNEL_ID,
        currency: 'EUR',
      }),
    );
    expect(foreignRequests()).toEqual([]);
  });

  it('names a preselected organization from the lookup', async () => {
    renderCrm(<OpportunityCreatePage />, {
      path: `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}`,
      pattern: '/crm/opportunities/new',
      permissions: ['crm:read', 'crm:write', 'orders:read'],
    });
    await waitFor(() =>
      expect(screen.getByLabelText(en('opportunity.field.organization'))).toHaveValue('Acme'),
    );
    expect(requested()).toContain(`/api/v1/admin/crm/lookups/organizations?id=${ORGANIZATION_ID}`);
    expect(foreignRequests()).toEqual([]);
  });
});
