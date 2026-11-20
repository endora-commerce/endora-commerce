import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-018, FR-039,
 * contracts/admin-panel-and-check.md §3) — the member direct-create on the
 * Organization screen embeds the `customer` custom fields: the panel renders,
 * its bag travels as `customFieldValues` in `POST …/members`, and a
 * `422 CUSTOM_FIELD_VALUE_INVALID` is said at the field it names.
 *
 * Issue #1516 (SALES-14) — the direct create is the *Create the account now* way of the
 * *Add member* dialog, so the fields are asked for only once that way is chosen.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// Sibling panels with data chains of their own; none is under test here.
vi.mock('../../../../packages/modules/organizations/src/admin/panels/FulfilmentStrategyPanel', () => ({
  FulfilmentStrategyPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel', () => ({
  ModerationActionsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ApplicablePriceListsPanel', () => ({
  ApplicablePriceListsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/HierarchyPanel', () => ({ HierarchyPanel: () => null }));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel', () => ({
  VatValidationPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/RestrictionsPanel', () => ({
  RestrictionsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/SalesChannelsPanel', () => ({
  SalesChannelsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({
  OrganizationSalesRepsTab: () => null,
}));

const { OrganizationDetail } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail'
);
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const OWN_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN, organizations: OWN_EN };
const core = (key: string): string => CORE_EN[key]!;

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const MEMBERS_URL = `/api/v1/admin/organizations/${ORG_ID}/members`;
const CUSTOMER_DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=customer';
const CUSTOMER_DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d176',
  entityType: 'customer',
  key: 'badge_number',
  label: { en: 'Badge number' },
  labelDefault: 'Badge number',
  valueType: 'text',
  required: false,
  audience: 'internal',
  sortOrder: 0,
  config: {},
  options: [],
  customerInput: [],
  adminAccess: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORG = {
  id: ORG_ID,
  name: 'Acme',
  legalName: null,
  taxId: '1234567890',
  status: 'active',
  vatStatus: 'vat_payer',
  isPersonal: false,
  registeredAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  orderConfirmationEmails: [],
  fulfilmentStrategy: null,
  fulfilmentStrategyWarehouseOrder: null,
  customFieldValues: {},
  parentId: null,
  members: [],
  updatedAt: '2026-05-01T09:00:00.000Z',
};

function renderDetail(permissions: readonly string[] = ['customers:read', 'customers:manage', 'custom_fields:read']): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: ORG });
    if (path === CUSTOMER_DEFINITIONS_URL) return Promise.resolve({ data: [CUSTOMER_DEFINITION] });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}?tab=members`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['organizations'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

/** Opens *Add member* on its create way; the custom fields are then asked for. */
async function openCreate(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: OWN_EN['members.add']! }));
  const dialog = await screen.findByRole('dialog', { name: OWN_EN['members.add']! });
  fireEvent.click(within(dialog).getByRole('radio', { name: OWN_EN['members.add.create']! }));
  return dialog;
}

/** A field by its label, the required asterisk (hidden from assistive technology) aside. */
function labelPattern(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`);
}

function byLabel(container: HTMLElement, text: string): HTMLInputElement {
  return within(container).getByLabelText(labelPattern(text)) as HTMLInputElement;
}

function fillMember(dialog: HTMLElement): void {
  fireEvent.change(byLabel(dialog, core('organizations.detail.email')), {
    target: { value: 'fay@acme.test' },
  });
  fireEvent.change(byLabel(dialog, core('organizations.detail.tempPassword')), {
    target: { value: 'a-long-password-1' },
  });
  fireEvent.change(byLabel(dialog, core('organizations.detail.firstName')), {
    target: { value: 'Fay' },
  });
  fireEvent.change(byLabel(dialog, core('organizations.detail.lastName')), {
    target: { value: 'Doe' },
  });
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('OrganizationDetail — member direct-create custom fields (feature 175)', () => {
  it('renders the customer custom fields in the direct-create form and sends their bag', async () => {
    postSpy.mockResolvedValue({ data: {} });
    renderDetail();
    const dialog = await openCreate();
    const field = await within(dialog).findByLabelText('Badge number');
    fillMember(dialog);
    fireEvent.change(field, { target: { value: 'B-17' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.createMember') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[0]).toBe(MEMBERS_URL);
    expect(postSpy.mock.calls[0]?.[1]).toMatchObject({ email: 'fay@acme.test', customFieldValues: { badge_number: 'B-17' } });
  });

  it('says a refusal at the field it names', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'CUSTOM_FIELD_VALUE_INVALID',
          message: 'One or more custom fields are invalid.',
          requestId: 'r',
          details: [{ path: 'badge_number', issue: 'Text value is too long.' }],
        },
      } as never),
    );
    renderDetail();
    const dialog = await openCreate();
    const field = await within(dialog).findByLabelText('Badge number');
    fillMember(dialog);
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.createMember') }));

    await waitFor(() => expect(screen.getByText('Text value is too long.')).toBeTruthy());
    expect(field.parentElement).toContainElement(screen.getByText('Text value is too long.'));
  });

  it('does not ask for the customer definitions without custom_fields:read', async () => {
    renderDetail(['customers:read', 'customers:manage']);
    const dialog = await openCreate();
    expect(byLabel(dialog, core('organizations.detail.tempPassword'))).toBeInTheDocument();
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(CUSTOMER_DEFINITIONS_URL);
  });
});
