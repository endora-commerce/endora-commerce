import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1040 — *Change tax ID* on a company Organization's page: offered under
 * `organizations:change-tax-id` for a live company only, absent when
 * `organizations` is off, the conflict inline on the field.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/FulfilmentStrategyPanel`, () => ({ FulfilmentStrategyPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel`, () => ({ ModerationActionsPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/ApplicablePriceListsPanel`, () => ({ ApplicablePriceListsPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/HierarchyPanel`, () => ({ HierarchyPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel`, () => ({ VatValidationPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/RestrictionsPanel`, () => ({ RestrictionsPanel: () => null }));
vi.mock(`../../../../packages/modules/organizations/src/admin/panels/SalesChannelsPanel`, () => ({ SalesChannelsPanel: () => null }));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({
  OrganizationSalesRepsTab: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationRolesTab', () => ({
  OrganizationRolesTab: () => null,
}));
const { OrganizationDetail } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const PL = read('../packages/modules/organizations/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const ORG_ID = '00000000-0000-4000-8000-0000000010a0';
const COMPANY = {
  id: ORG_ID,
  name: 'Kowalski Usługi',
  legalName: null,
  taxId: 'PL5260250995',
  isPersonal: false,
  status: 'active',
  vatStatus: 'vat_payer',
  registeredAddress: { street: 'ul. Firmowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
  orderConfirmationEmails: [],
  fulfilmentStrategy: null,
  fulfilmentStrategyWarehouseOrder: null,
  customFieldValues: {},
  parentId: null,
  members: [],
  createdAt: '2026-05-01T09:00:00.000Z',
  updatedAt: '2026-05-01T09:00:00.000Z',
};
const PERSONAL = { ...COMPANY, name: 'Jan Kowalski', taxId: null, isPersonal: true, vatStatus: 'vat_exempt' };

let current: typeof COMPANY | typeof PERSONAL = COMPANY;

function serve(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: current });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

function render(
  permissions: string[] = ['*'],
  present: string[] = ['organizations'],
): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
          <Routes>
            <Route path="/organizations/:id" element={<OrganizationDetail />} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions }), presence: modulePresence({ present }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

const button = (): Promise<HTMLElement> => screen.findByRole('button', { name: EN['changeTaxId.button']! });

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(await button());
  return screen.findByRole('dialog');
}

const taxIdField = (dialog: HTMLElement): HTMLInputElement =>
  within(dialog).getByLabelText(new RegExp(`^${EN['changeTaxId.field.taxId']!}`)) as HTMLInputElement;

const submit = (dialog: HTMLElement): void => {
  fireEvent.click(within(dialog).getByRole('button', { name: EN['changeTaxId.submit']! }));
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  current = COMPANY;
  serve();
});

describe('Change tax ID — on the organization page', () => {
  it('is offered for a company organization to a holder of the permission', async () => {
    render();
    expect(await button()).toBeInTheDocument();
  });

  it('is not offered without organizations:change-tax-id', async () => {
    render(['customers:read', 'customers:manage']);
    await screen.findByText('Kowalski Usługi');
    expect(screen.queryByRole('button', { name: EN['changeTaxId.button']! })).toBeNull();
  });

  it('is not offered for a personal organization', async () => {
    current = PERSONAL;
    render();
    await screen.findByText('Jan Kowalski');
    expect(screen.queryByRole('button', { name: EN['changeTaxId.button']! })).toBeNull();
  });

  it('is absent when organizations is off (Principle XVII)', async () => {
    render(['*'], []);
    await screen.findByText('Kowalski Usługi');
    expect(screen.queryByRole('button', { name: EN['changeTaxId.button']! })).toBeNull();
  });

  it('starts on the current tax ID, explains what is kept, and normalises on blur', async () => {
    render();
    const dialog = await openDialog();
    expect(within(dialog).getByText(EN['changeTaxId.explanation']!)).toBeInTheDocument();
    const field = taxIdField(dialog);
    expect(field.value).toBe('PL5260250995');
    fireEvent.change(field, { target: { value: ' pl 526-025-11-77 ' } });
    fireEvent.blur(field);
    expect(field.value).toBe('PL5260251177');
  });

  it('links a length error to its field and sends nothing', async () => {
    render();
    const dialog = await openDialog();
    fireEvent.change(taxIdField(dialog), { target: { value: '123' } });
    submit(dialog);
    const field = taxIdField(dialog);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(dialog.querySelector(`#${field.getAttribute('aria-describedby')!}`)).toHaveTextContent(
      EN['changeTaxId.error.taxIdLength']!,
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('shows a taken tax ID inline on the field', async () => {
    postSpy.mockRejectedValue(new ApiError(409, { error: { code: 'ORGANIZATION_TAX_ID_EXISTS', message: 'Taken.' } } as never));
    render();
    const dialog = await openDialog();
    fireEvent.change(taxIdField(dialog), { target: { value: 'PL5260251177' } });
    submit(dialog);
    const field = taxIdField(dialog);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(dialog.querySelector(`#${field.getAttribute('aria-describedby')!.split(' ')[0]}`)).toHaveTextContent('Taken.');
  });

  it('shows a refusal as an alert in the dialog', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'ORGANIZATION_TAX_ID_CHANGE_REFUSED', message: 'Refused here.', details: { code: 'deleted' } },
      } as never),
    );
    render();
    const dialog = await openDialog();
    fireEvent.change(taxIdField(dialog), { target: { value: 'PL5260251177' } });
    submit(dialog);
    expect(await within(dialog).findByText('Refused here.')).toBeInTheDocument();
  });

  it('marks the submit busy, then closes, refreshes and reports the VAT outcome', async () => {
    let finish: (value: unknown) => void = () => undefined;
    postSpy.mockImplementation(() => new Promise((r) => (finish = r)));
    render();
    const dialog = await openDialog();
    fireEvent.change(taxIdField(dialog), { target: { value: 'PL5260251177' } });
    submit(dialog);
    const submitButton = within(dialog).getByRole('button', { name: EN['changeTaxId.submit']! });
    await waitFor(() => expect(submitButton).toHaveAttribute('aria-busy', 'true'));
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG_ID}/change-tax-id`, {
      taxId: 'PL5260251177',
      validateTaxId: true,
    });
    current = { ...COMPANY, taxId: 'PL5260251177' };
    finish({ data: current, changed: true, vatValidation: { outcome: 'validated', provider: 'mf_pl' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(EN['changeTaxId.success.validated']!)).toBeInTheDocument();
  });

  it('says so when the value was already the stored one', async () => {
    postSpy.mockResolvedValue({ data: COMPANY, changed: false, vatValidation: null });
    render();
    const dialog = await openDialog();
    submit(dialog);
    expect(await screen.findByText(EN['changeTaxId.success.unchanged']!)).toBeInTheDocument();
  });

  it('offers no VAT validation without customers:manage, and sends validateTaxId false', async () => {
    postSpy.mockResolvedValue({ data: COMPANY, changed: true, vatValidation: null });
    render(['customers:read', 'organizations:change-tax-id']);
    const dialog = await openDialog();
    expect(within(dialog).queryByLabelText(EN['changeTaxId.field.validate']!)).toBeNull();
    fireEvent.change(taxIdField(dialog), { target: { value: 'PL5260251177' } });
    submit(dialog);
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG_ID}/change-tax-id`, {
        taxId: 'PL5260251177',
        validateTaxId: false,
      }),
    );
  });

  it('has no axe violations in the dialog', async () => {
    render();
    const dialog = await openDialog();
    await expectNoAxeViolations(dialog);
  });

  it('has its keys in both bundles', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('changeTaxId.'));
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) expect(PL[key], key).toEqual(expect.any(String));
  });
});
