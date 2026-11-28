import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ORGANIZATION_FORMS,
  type AdminFieldContribution,
  type EffectiveField,
  type EffectiveFormsResponse,
  type FieldSlotProps,
  type OrganizationSalesChannelOptionsResponse,
} from '@endora-commerce/contracts';
import { EffectiveFormsProvider } from '@endora-commerce/admin-kit/lib';
import { Input } from '@endora-commerce/admin-kit/ui';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';

/**
 * `specs/193-admin-form-extensions/` WP-E1 (T044, T045; FR-013, FR-016,
 * FR-080; SC-001, SC-006) — the organization forms render through the admin
 * kit's declared form, so what a deployment adds reaches them with no edit
 * under `packages/modules/organizations/`:
 *
 * - a module's slot field renders at its anchor, and its value travels in the
 *   host's one request as `extensions.<moduleId>` — the create's `POST` and the
 *   Organization page's one Save `PATCH`;
 * - the detail read asks for exactly the modules whose slots it renders;
 * - an effective override relabels a field, and a hidden field is not sent.
 *
 * That the screens are otherwise unchanged is the existing organization admin
 * tests, run unedited (T044).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

// Data-heavy siblings of the detail page that are not under test.
vi.mock('../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel', () => ({ VatValidationPanel: () => null }));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ApplicablePriceListsPanel', () => ({ ApplicablePriceListsPanel: () => null }));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({ OrganizationSalesRepsTab: () => null }));

const { OrganizationCreate } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationCreate');
const { OrganizationDetail } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail');

const read = (path: string): Record<string, string> => JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const en = read('../packages/modules/organizations/i18n/en.json');
const bundle = {
  organizations: en,
  core: read('../packages/modules/_i18n/i18n/en.json'),
  _lifecycle: read('../packages/platform/src/lifecycle/i18n/en.json'),
  acme_erp: { 'slot.erpCode': 'ERP customer number' },
};

const RETAIL = '00000000-0000-4000-8000-00000000c001';
const CREATED = '00000000-0000-4000-8000-00000000d001';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;
const UPDATED_AT = '2026-11-28T09:00:00.000Z';

const OPTIONS: OrganizationSalesChannelOptionsResponse = {
  data: [{ id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true }],
};

function ErpCode(props: FieldSlotProps<string>): ReactNode {
  return <Input {...props.control} value={props.value ?? ''} readOnly={props.readOnly} onChange={(event): void => props.onChange(event.target.value)} />;
}

/** `acme_erp`'s slot: after the tax ID on the create form, at the end of the notifications on the edit form. */
const SLOTS: AdminFieldContribution[] = [
  {
    fieldSet: 'organization',
    forms: [ORGANIZATION_FORMS.create.id],
    key: 'erpCode',
    type: 'string',
    anchor: { field: 'taxId', position: 'after' },
    weight: 0,
    labelKey: 'slot.erpCode',
    component: () => Promise.resolve({ default: ErpCode }),
  },
  {
    fieldSet: 'organization',
    forms: [ORGANIZATION_FORMS.edit.id],
    key: 'erpCode',
    type: 'string',
    anchor: { section: 'notifications', position: 'end' },
    weight: 0,
    labelKey: 'slot.erpCode',
    component: () => Promise.resolve({ default: ErpCode }),
  },
];
const CONTRIBUTIONS = [{ moduleId: 'acme_erp', contributions: { fields: SLOTS } }] as never;

const field = (key: string, section: string, order: number, extra: Partial<EffectiveField> = {}): EffectiveField => ({
  key,
  section,
  order,
  readOnly: false,
  hidden: false,
  control: null,
  overriddenBy: [],
  operatorKinds: [],
  ...extra,
});

/** A deployment that relabels the name and hides the status on the create form. */
const OVERRIDDEN: EffectiveFormsResponse = {
  forms: [
    {
      id: ORGANIZATION_FORMS.create.id,
      fieldSet: 'organization',
      fields: [
        field('name', 'identity', 0, { label: { source: 'operator', text: { en: 'Company name' } }, operatorKinds: ['label'] }),
        field('taxId', 'identity', 1),
        field('parentId', 'parent', 2),
        field('registeredAddress', 'address', 3),
        field('status', 'access', 4, { hidden: true }),
        field('salesChannelIds', 'access', 5),
      ],
    },
  ],
};

function renderCreate(options: { present: readonly string[]; forms?: EffectiveFormsResponse }): void {
  renderWithSession(
    <MemoryRouter initialEntries={['/organizations/new']}>
      <EffectiveFormsProvider {...(options.forms ? { initial: options.forms } : { initial: { forms: [] } })}>
        <Routes>
          <Route path="/organizations/new" element={<OrganizationCreate />} />
          <Route path="/organizations/:id" element={<p>detail page</p>} />
        </Routes>
      </EffectiveFormsProvider>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['customers:manage'] }),
      presence: modulePresence({ present: ['organizations', ...options.present] }),
      contributions: CONTRIBUTIONS,
      bundle,
    },
  );
}

function fill(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillCreate(name: string | RegExp = en['create.field.name']!): void {
  fill(name, 'Acme Trade');
  fill(en['create.field.taxId']!, 'PL5260001246');
  fill(en['create.field.street']!, 'ul. Prosta 1');
  fill(en['create.field.postalCode']!, '00-001');
  fill(en['create.field.city']!, 'Warszawa');
  fill(en['create.field.country']!, 'pl');
}

const CORE_BODY = {
  name: 'Acme Trade',
  taxId: 'PL5260001246',
  registeredAddress: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
  salesChannelIds: [RETAIL],
};

let stored: Record<string, unknown>;

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  putSpy.mockReset();
  stored = {
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
    version: 3,
    updatedAt: UPDATED_AT,
  };
  getSpy.mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/organizations/sales-channel-options') return OPTIONS;
    if (url === `${ORG_URL}?extensions=acme_erp`) return { data: { ...stored, extensions: { acme_erp: { erpCode: 'E-0' } } } };
    if (url === ORG_URL) return { data: { ...stored } };
    if (url === `${ORG_URL}/restrictions`) {
      return { data: { organizationId: ORG_ID, paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: stored['version'] } };
    }
    const channels = organizationSalesChannelsAnswer(url);
    if (channels) return channels;
    return { data: [], items: [] };
  });
  postSpy.mockResolvedValue({ data: { id: CREATED } });
  patchSpy.mockImplementation(async () => ({ data: { ...stored, version: 4 } }));
});
afterEach(() => cleanup());

describe('New organization — the declared form organization.create', () => {
  it('renders a present module’s slot after the tax ID and sends its value as extensions in the one POST', async () => {
    renderCreate({ present: ['acme_erp'] });
    const erp = await screen.findByLabelText('ERP customer number');
    const taxId = screen.getByLabelText(en['create.field.taxId']!);
    expect(taxId.compareDocumentPosition(erp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(erp.compareDocumentPosition(screen.getByLabelText(en['create.field.street']!)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => expect((screen.getByRole('checkbox', { name: /Retail/ }) as HTMLInputElement).checked).toBe(true));
    fillCreate();
    fireEvent.change(erp, { target: { value: 'E-1' } });
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/organizations', {
      ...CORE_BODY,
      status: 'active',
      extensions: { acme_erp: { erpCode: 'E-1' } },
    });
  });

  it('renders no slot and sends no extensions while the module is switched off', async () => {
    renderCreate({ present: [] });
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /Retail/ }) as HTMLInputElement).checked).toBe(true));
    expect(screen.queryByLabelText('ERP customer number')).toBeNull();
    fillCreate();
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).not.toHaveProperty('extensions');
  });

  it('applies the effective overrides: the operator’s label, and a hidden status that is not sent', async () => {
    renderCreate({ present: [], forms: OVERRIDDEN });
    expect(await screen.findByLabelText('Company name')).toBeInTheDocument();
    expect(screen.queryByLabelText(en['create.field.name']!)).toBeNull();
    expect(screen.queryByLabelText(en['create.field.status']!)).toBeNull();
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /Retail/ }) as HTMLInputElement).checked).toBe(true));
    fillCreate('Company name');
    fireEvent.click(screen.getByRole('button', { name: en['create.submit']! }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/organizations', CORE_BODY);
  });
});

describe('the Organization page — the declared form organization.edit', () => {
  function renderDetail(present: readonly string[]): void {
    renderWithSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['organizations', ...present] }),
        contributions: CONTRIBUTIONS,
        bundle,
      },
    );
  }

  it('reads the record with the slot module’s extensions and shows its stored value', async () => {
    renderDetail(['acme_erp']);
    const erp = await screen.findByLabelText('ERP customer number');
    await waitFor(() => expect((erp as HTMLInputElement).value).toBe('E-0'));
    expect(getSpy).toHaveBeenCalledWith(`${ORG_URL}?extensions=acme_erp`);
    expect(getSpy).not.toHaveBeenCalledWith(ORG_URL);
  });

  it('reads the record as it always did with no slot module present', async () => {
    renderDetail([]);
    await screen.findByLabelText(en['detail.orderConfirmationEmails']!);
    expect(getSpy).toHaveBeenCalledWith(ORG_URL);
    expect(screen.queryByLabelText('ERP customer number')).toBeNull();
  });

  it('counts a changed slot value as a host change and writes it in the one PATCH as extensions', async () => {
    renderDetail(['acme_erp']);
    const erp = await screen.findByLabelText('ERP customer number');
    await waitFor(() => expect((erp as HTMLInputElement).value).toBe('E-0'));
    fireEvent.change(erp, { target: { value: 'E-1' } });
    const save = await screen.findByRole('button', { name: 'Save 1 change' });
    fireEvent.click(save);
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(ORG_URL, { extensions: { acme_erp: { erpCode: 'E-1' } }, expectedUpdatedAt: UPDATED_AT });
  });
});
