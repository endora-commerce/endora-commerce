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
 * `specs/177-tax-id-scope/` T061 (FR-042; `contracts/admin-surfaces.md` §4.2) —
 * *Convert to company* on a personal Organization's page.
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
  OrganizationRolesTab: ({ isPersonal }: { isPersonal: boolean }) => (isPersonal ? null : <section data-testid="roles-tab" />),
}));
const { OrganizationDetail } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const PL = read('../packages/modules/organizations/i18n/pl.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const ORG_ID = '00000000-0000-4000-8000-0000000000c7';
const PERSONAL = {
  id: ORG_ID,
  name: 'Jan Kowalski',
  legalName: null,
  taxId: null,
  isPersonal: true,
  status: 'active',
  vatStatus: 'vat_exempt',
  registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
  orderConfirmationEmails: [],
  fulfilmentStrategy: null,
  fulfilmentStrategyWarehouseOrder: null,
  customFieldValues: {},
  parentId: null,
  members: [],
  createdAt: '2026-05-01T09:00:00.000Z',
  updatedAt: '2026-05-01T09:00:00.000Z',
};
const COMPANY = { ...PERSONAL, name: 'Kowalski Usługi', taxId: 'PL5260250995', isPersonal: false, vatStatus: 'vat_payer' };

let current: typeof PERSONAL | typeof COMPANY = PERSONAL;

function serve(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: current });
    if (path.startsWith('/api/v1/dictionary')) {
      return Promise.resolve({
        data: {
          countries: [
            { code: 'PL', label: 'Poland', alpha3Code: 'POL', numericCode: '616', region: 'europe', subregion: null, dialCode: '+48', isEuMember: true, sortOrder: 1 },
          ],
        },
      });
    }
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

function render(permissions: string[] = ['*']): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      // The app shell provides the language `CountrySelect` labels countries in.
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
          <Routes>
            <Route path="/organizations/:id" element={<OrganizationDetail />} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: EN['convertToCompany.button']! }));
  return screen.findByRole('dialog');
}

const field = (dialog: HTMLElement, key: string): HTMLInputElement =>
  within(dialog).getByLabelText(new RegExp(`^${EN[key]!}`)) as HTMLInputElement;

function fillValid(dialog: HTMLElement): void {
  fireEvent.change(field(dialog, 'convertToCompany.field.name'), { target: { value: 'Kowalski Usługi' } });
  fireEvent.change(field(dialog, 'convertToCompany.field.taxId'), { target: { value: '5260250995' } });
  fireEvent.change(field(dialog, 'convertToCompany.field.street'), { target: { value: 'ul. Firmowa 1' } });
  fireEvent.change(field(dialog, 'convertToCompany.field.postalCode'), { target: { value: '80-001' } });
  fireEvent.change(field(dialog, 'convertToCompany.field.city'), { target: { value: 'Gdańsk' } });
}

const submit = (dialog: HTMLElement): void => {
  fireEvent.click(within(dialog).getByRole('button', { name: EN['convertToCompany.submit']! }));
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  current = PERSONAL;
  serve();
});

describe('Convert to company — on the organization page', () => {
  it('is offered for a personal organization to a holder of the permission only', async () => {
    render();
    expect(await screen.findByRole('button', { name: EN['convertToCompany.button']! })).toBeInTheDocument();
  });

  it('is not offered without organizations:convert-to-company', async () => {
    render(['customers:read', 'customers:manage']);
    await screen.findByText('Jan Kowalski');
    expect(screen.queryByRole('button', { name: EN['convertToCompany.button']! })).toBeNull();
  });

  it('is not offered for a company', async () => {
    current = COMPANY;
    render();
    await screen.findByText('Kowalski Usługi');
    expect(screen.queryByRole('button', { name: EN['convertToCompany.button']! })).toBeNull();
  });

  it('explains what happens, and links each field error to its field', async () => {
    render();
    const dialog = await openDialog();
    expect(within(dialog).getByText(EN['convertToCompany.explanation']!)).toBeInTheDocument();
    submit(dialog);
    const name = field(dialog, 'convertToCompany.field.name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    const describedBy = name.getAttribute('aria-describedby')!;
    expect(dialog.querySelector(`#${describedBy}`)).toHaveTextContent(EN['convertToCompany.error.required']!);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('normalises the tax ID on blur', async () => {
    render();
    const dialog = await openDialog();
    const taxId = field(dialog, 'convertToCompany.field.taxId');
    fireEvent.change(taxId, { target: { value: ' pl 526-025-09-95 ' } });
    fireEvent.blur(taxId);
    expect(taxId.value).toBe('PL5260250995');
  });

  it('shows a taken tax ID on the tax-ID field', async () => {
    postSpy.mockRejectedValue(new ApiError(409, { error: { code: 'ORGANIZATION_TAX_ID_EXISTS', message: 'Taken.' } } as never));
    render();
    const dialog = await openDialog();
    fillValid(dialog);
    submit(dialog);
    const taxId = field(dialog, 'convertToCompany.field.taxId');
    await waitFor(() => expect(taxId).toHaveAttribute('aria-invalid', 'true'));
    expect(dialog.querySelector(`#${taxId.getAttribute('aria-describedby')!.split(' ')[0]}`)).toHaveTextContent('Taken.');
  });

  it('shows a refusal as an alert in the dialog', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'ORGANIZATION_CONVERSION_REFUSED', message: 'This organization is already a company.', details: { code: 'not_personal' } },
      } as never),
    );
    render();
    const dialog = await openDialog();
    fillValid(dialog);
    submit(dialog);
    expect(await within(dialog).findByText('This organization is already a company.')).toBeInTheDocument();
  });

  it('marks the submit busy, then closes, refreshes into a company and reports the VAT outcome', async () => {
    let finish: (value: unknown) => void = () => undefined;
    postSpy.mockImplementation(() => new Promise((r) => (finish = r)));
    render();
    const dialog = await openDialog();
    fillValid(dialog);
    submit(dialog);
    const button = within(dialog).getByRole('button', { name: EN['convertToCompany.submit']! });
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG_ID}/convert-to-company`, {
      name: 'Kowalski Usługi',
      taxId: '5260250995',
      registeredAddress: { street: 'ul. Firmowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
      vatStatus: 'vat_payer',
      validateTaxId: true,
    });
    current = COMPANY;
    finish({ data: COMPANY, vatValidation: { outcome: 'validated', provider: 'mf_pl' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByTestId('roles-tab')).toBeInTheDocument();
    expect(screen.getByText(EN['convertToCompany.success.validated']!)).toBeInTheDocument();
  });

  it('hides the validation box and sends it unticked to an operator without customers:manage', async () => {
    // The route refuses `validateTaxId: true` without `customers:manage` with a
    // 403 for the whole conversion, so the default form must not ask for it.
    postSpy.mockResolvedValue({ data: COMPANY, vatValidation: null });
    render(['customers:read', 'organizations:convert-to-company']);
    const dialog = await openDialog();
    expect(within(dialog).queryByLabelText(EN['convertToCompany.field.validate']!)).toBeNull();
    fillValid(dialog);
    submit(dialog);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]![1]).toMatchObject({ validateTaxId: false });
  });

  it('shows the validation box, ticked, to an operator holding customers:manage', async () => {
    render(['customers:read', 'customers:manage', 'organizations:convert-to-company']);
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText(EN['convertToCompany.field.validate']!)).toBeChecked();
  });

  it('has no axe violations in the dialog', async () => {
    render();
    const dialog = await openDialog();
    await expectNoAxeViolations(dialog);
  });

  it('has its keys in both bundles', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('convertToCompany.'));
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) expect(PL[key], key).toEqual(expect.any(String));
  });
});
