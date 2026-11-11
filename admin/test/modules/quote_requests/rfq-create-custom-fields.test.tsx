import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-019, FR-039,
 * contracts/admin-panel-and-check.md §3) — the create-quote-request screen
 * embeds the request's custom fields: the panel renders (its definitions are
 * `custom_fields:read`'s), its bag travels as `customFieldValues` in
 * `POST /api/v1/admin/quote-requests`, and a `422 CUSTOM_FIELD_VALUE_INVALID` is
 * said at the field it names, the form kept as typed.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();
const creates = (): unknown[][] => postSpy.mock.calls.filter(([path]) => path === '/api/v1/admin/quote-requests');

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
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

const { RfqCreatePage } = await import(
  '../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage'
);
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  organizationName: 'Acme',
};
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', type: 'simple', name: 'Widget' };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=quote_request';
const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000f175',
  entityType: 'quote_request',
  key: 'tender_no',
  label: { en: 'Tender number' },
  labelDefault: 'Tender number',
  valueType: 'text',
  required: true,
  audience: 'internal',
  sortOrder: 0,
  config: {},
  options: [],
  customerInput: [],
  adminAccess: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BUNDLE = passthroughBundle('core', [
  'rfqCreate.submit',
  'rfqCreate.back',
  'rfqCreate.items.quickSearch',
  'rfqCreate.field.agreedUnitPrice',
  'customFields.title',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === DEFINITIONS_URL) return Promise.resolve({ data: [DEFINITION] });
    const channels = organizationSalesChannelsAnswer(path);
    if (channels) return channels;
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/v1/admin/price-books/resolve'
        ? { data: [{ key: 'line', price: { amount: '10.00', currency: 'PLN', source: 'base' } }] }
        : { data: { id: 'new-rfq-1' } },
    ),
  );
});

function renderPage(permissions: readonly string[] = ['*']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/quote-requests/new']}>
        <RfqCreatePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['quote_requests'] }),
      },
    ),
    BUNDLE,
  );
}

async function fillRequest(): Promise<HTMLElement> {
  await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
  await userEvent.click(screen.getByLabelText('customerAccountId'));
  await userEvent.click(await screen.findByRole('option', { name: /Jan Kowalski/ }));
  const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
  await userEvent.type(quick, 'Wid');
  await userEvent.click(await screen.findByRole('option', { name: /Widget/ }));
  await waitFor(() =>
    expect(screen.getByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' })).toHaveValue(10),
  );
  const submit = screen.getByText('rfqCreate.submit');
  await waitFor(() => expect(submit).not.toBeDisabled());
  return submit;
}

describe('RfqCreatePage — custom fields (feature 175)', () => {
  it('renders the quote request custom fields and sends their bag with the create', async () => {
    renderPage();
    const submit = await fillRequest();
    await userEvent.type(await screen.findByLabelText('Tender number *'), 'T-2026/7');
    await userEvent.click(submit);

    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]?.[1]).toMatchObject({ customFieldValues: { tender_no: 'T-2026/7' } });
  });

  it('says a refusal at the field it names and keeps the form', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/price-books/resolve') {
        return Promise.resolve({ data: [{ key: 'line', price: { amount: '10.00', currency: 'PLN', source: 'base' } }] });
      }
      return Promise.reject(
        new ApiError(422, {
          error: {
            code: 'CUSTOM_FIELD_VALUE_INVALID',
            message: 'One or more custom fields are invalid.',
            requestId: 'r',
            details: [{ path: 'tender_no', issue: 'Field "tender_no" is required.' }],
          },
        } as never),
      );
    });
    renderPage();
    const submit = await fillRequest();
    const input = await screen.findByLabelText('Tender number *');
    await userEvent.click(submit);

    await waitFor(() => expect(screen.getByText('Field "tender_no" is required.')).toBeTruthy());
    expect(input.parentElement).toContainElement(screen.getByText('Field "tender_no" is required.'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('neither asks for the definitions nor sends values without custom_fields:read', async () => {
    renderPage(['quote_requests:read', 'quote_requests:write', 'customers:read', 'catalog:read']);
    const submit = await fillRequest();
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(DEFINITIONS_URL);
    expect(creates()[0]?.[1]).not.toHaveProperty('customFieldValues');
  });
});
