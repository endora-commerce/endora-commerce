import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EVERY_CRM_PERMISSION,
  core,
  OPPORTUNITY_ID,
  ORGANIZATION_ID,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * Operator-defined fields on an Opportunity (`specs/143-crm-sales-opportunities/`,
 * User Story 15 — task T155).
 *
 * The fields are the kit's `CustomFieldValuesPanel` for `entityType="opportunity"`.
 * On the Opportunity it saves through the Opportunity's own `PATCH`, with
 * `If-Match`; on the create form it is embedded — no button of its own — and
 * its values travel in the create request. A refusal naming a field is shown at
 * that field. Reading the definitions is `custom_fields`' permission, so a
 * person without it is shown no fields rather than a refused request.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OverviewTab } = await import(
  '../../../../packages/modules/crm/src/admin/pages/opportunity-detail/tabs/OverviewTab'
);
const { OpportunityCreatePage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityCreatePage'
);

const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=opportunity';
const WITH_FIELDS = [...EVERY_CRM_PERMISSION, 'custom_fields:read'];

const base = {
  entityType: 'opportunity',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const DEFINITIONS = [
  {
    ...base,
    id: '00000000-0000-4000-8000-00000000d101',
    key: 'lead_source',
    label: { en: 'Lead source', pl: 'Źródło kontaktu' },
    labelDefault: 'Lead source',
    valueType: 'select',
    required: true,
    options: [
      { id: 'o1', value: 'referral', label: { en: 'Referral' }, labelDefault: 'Referral', isDefault: false, sortOrder: 0 },
      { id: 'o2', value: 'trade_fair', label: { en: 'Trade fair' }, labelDefault: 'Trade fair', isDefault: false, sortOrder: 1 },
    ],
  },
  {
    ...base,
    id: '00000000-0000-4000-8000-00000000d102',
    key: 'competitor',
    label: { en: 'Competitor' },
    labelDefault: 'Competitor',
    valueType: 'text',
  },
];

function refusal(): InstanceType<typeof ApiError> {
  return new ApiError(422, {
    error: {
      code: 'CUSTOM_FIELD_VALUE_INVALID',
      message: 'One or more custom fields are invalid.',
      details: [{ path: 'lead_source', issue: 'Field "lead_source" is required.' }],
      requestId: 'req_test',
    },
  } as never);
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === DEFINITIONS_URL) return Promise.resolve({ data: DEFINITIONS });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('custom fields on the Opportunity (Overview)', () => {
  const opportunity = detail({ version: 4, customFieldValues: { lead_source: 'referral', competitor: 'Globex' } });

  function renderOverview(permissions: readonly string[] = WITH_FIELDS, onChange = vi.fn()): typeof onChange {
    renderCrm(
      <OverviewTab
        opportunity={opportunity}
        onChange={onChange}
        reload={async (): Promise<void> => {}}
        orderStatuses={[]}
        editing={false}
        onEditingChange={(): void => {}}
      />,
      { permissions },
    );
    return onChange;
  }

  it('renders the fields defined for opportunities, with the stored values', async () => {
    renderOverview();
    expect(await screen.findByLabelText(/Lead source/)).toHaveValue('referral');
    expect(screen.getByLabelText('Competitor')).toHaveValue('Globex');
    expect(getSpy.mock.calls.map(([path]) => path)).toContain(DEFINITIONS_URL);
  });

  it('saves through the Opportunity’s own PATCH, with If-Match, and puts the answer on screen', async () => {
    const saved = detail({ version: 5, customFieldValues: { lead_source: 'trade_fair', competitor: 'Globex' } });
    patchSpy.mockResolvedValue({ data: saved });
    const onChange = renderOverview();

    await userEvent.selectOptions(await screen.findByLabelText(/Lead source/), 'trade_fair');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`,
      { customFieldValues: { lead_source: 'trade_fair', competitor: 'Globex' } },
      { headers: { 'If-Match': '"4"' } },
    ]);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
  });

  it('sends a cleared choice as null, so the stored value does not come back', async () => {
    patchSpy.mockResolvedValue({ data: detail({ version: 5, customFieldValues: { competitor: 'Globex' } }) });
    renderOverview();
    await userEvent.selectOptions(await screen.findByLabelText(/Lead source/), '');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      customFieldValues: { lead_source: null, competitor: 'Globex' },
    });
  });

  it('shows a refusal at the field it names', async () => {
    patchSpy.mockRejectedValue(refusal());
    renderOverview();

    const select = await screen.findByLabelText(/Lead source/);
    await userEvent.selectOptions(select, '');
    await userEvent.click(screen.getByRole('button', { name: core('customFields.save') }));

    const message = await screen.findByText('Field "lead_source" is required.');
    expect(select.parentElement).toContainElement(message);
  });

  it('shows the values, and nothing to change, to somebody who may not edit', async () => {
    renderOverview(['crm:read', 'orders:read', 'custom_fields:read']);
    expect(await screen.findByText('Lead source')).toBeTruthy();
    expect(screen.getByText('Referral')).toBeTruthy();
    expect(screen.getByText('Globex')).toBeTruthy();
    expect(screen.queryByRole('button', { name: core('customFields.save') })).toBeNull();
    expect(screen.queryByLabelText(/Lead source/)).toBeNull();
  });

  it('asks for no definitions without the permission to read them', async () => {
    renderOverview(EVERY_CRM_PERMISSION);
    await screen.findByRole('heading', { level: 2, name: en('opportunity.field.description') });
    expect(getSpy.mock.calls.map(([path]) => path)).not.toContain(DEFINITIONS_URL);
    expect(screen.queryByLabelText(/Lead source/)).toBeNull();
  });
});

describe('custom fields on the create form', () => {
  function renderPage(permissions: readonly string[] = WITH_FIELDS): void {
    renderCrm(<OpportunityCreatePage />, {
      permissions,
      path: `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}`,
      pattern: '/crm/opportunities/new',
    });
  }

  async function fillRequired(): Promise<void> {
    await userEvent.type(screen.getByLabelText(en('opportunity.field.title'), { exact: false }), 'Fleet');
    const currency = screen.getByLabelText(en('opportunity.field.currency'), { exact: false });
    await waitFor(() => expect(currency.querySelector('option[value="PLN"]')).not.toBeNull());
    await userEvent.selectOptions(currency, 'PLN');
  }

  it('renders the fields inside the form, with no button of their own, and sends their values', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    renderPage();
    const select = await screen.findByLabelText(/Lead source/);
    expect(screen.queryByRole('button', { name: core('customFields.save') })).toBeNull();
    expect(select.closest('form')).not.toBeNull();

    await fillRequired();
    await userEvent.selectOptions(select, 'referral');
    await userEvent.type(screen.getByLabelText('Competitor'), 'Globex');
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({
      title: 'Fleet',
      customFieldValues: { lead_source: 'referral', competitor: 'Globex' },
    });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/crm/opportunities/${OPPORTUNITY_ID}`));
  });

  it('shows a refusal at the field it names and stays on the form', async () => {
    postSpy.mockRejectedValue(refusal());
    renderPage();
    const select = await screen.findByLabelText(/Lead source/);
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));

    const message = await screen.findByText('Field "lead_source" is required.');
    expect(select.parentElement).toContainElement(message);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('sends no custom values when no field is defined or readable', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    renderPage(EVERY_CRM_PERMISSION);
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('customFieldValues');
    expect(getSpy.mock.calls.map(([path]) => path)).not.toContain(DEFINITIONS_URL);
  });

  it('names the refused fields in the form’s own message when the fields cannot be shown', async () => {
    postSpy.mockRejectedValue(refusal());
    renderPage(EVERY_CRM_PERMISSION);
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    expect(await screen.findByText(/Field "lead_source" is required\./)).toBeTruthy();
  });
});
