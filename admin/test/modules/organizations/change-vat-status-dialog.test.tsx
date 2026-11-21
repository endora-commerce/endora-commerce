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
 * Issue #1468 (SALES-01, owner ruling OQ-1 = B) — the VAT status is no longer a staged select of
 * the page's one Save. It is shown in the header and changed by *Change VAT status…*: an
 * immediately-applied dialog, offered under `customers:manage`, that sends the existing
 * `PATCH …/organizations/:id` with only `vatStatus` and `expectedUpdatedAt` — the audited
 * `organization.admin_patch` Command, which records the VAT codes before and after.
 */
const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: (...a: unknown[]) => patchSpy(...a), delete: vi.fn() },
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

const ORG_ID = '00000000-0000-4000-8000-0000000014a8';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;
const UPDATED_AT = '2026-05-01T09:00:00.000Z';
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
  version: 2,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
};
const PERSONAL = { ...COMPANY, name: 'Jan Kowalski', taxId: null, isPersonal: true, vatStatus: 'vat_exempt' };

let current: Record<string, unknown> = COMPANY;

function serve(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === ORG_URL) return Promise.resolve({ data: current });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

function render(permissions: string[] = ['*'], present: string[] = ['organizations']): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/organizations/${ORG_ID}?tab=tax`]}>
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

const button = (): Promise<HTMLElement> => screen.findByRole('button', { name: EN['changeVatStatus.button']! });

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(await button());
  return screen.findByRole('dialog');
}

const field = (dialog: HTMLElement): HTMLSelectElement =>
  within(dialog).getByLabelText(EN['changeVatStatus.field.vatStatus']!) as HTMLSelectElement;

const submit = (dialog: HTMLElement): void => {
  fireEvent.click(within(dialog).getByRole('button', { name: EN['changeVatStatus.submit']! }));
};

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  current = COMPANY;
  serve();
});

describe('Change VAT status — on the organization page (#1468)', () => {
  it('is offered for a company organization to a holder of customers:manage', async () => {
    render(['customers:read', 'customers:manage']);
    expect(await button()).toBeInTheDocument();
  });

  it('is offered for a personal organization too, which has a VAT status as well', async () => {
    current = PERSONAL;
    render();
    expect(await button()).toBeInTheDocument();
  });

  it('is not offered without customers:manage', async () => {
    render(['customers:read', 'organizations:change-tax-id']);
    await screen.findByText('Kowalski Usługi');
    expect(screen.queryByRole('button', { name: EN['changeVatStatus.button']! })).toBeNull();
  });

  it('is absent when organizations is off (Principle XVII)', async () => {
    render(['*'], []);
    await screen.findByText('Kowalski Usługi');
    expect(screen.queryByRole('button', { name: EN['changeVatStatus.button']! })).toBeNull();
  });

  it('starts on the stored VAT status, explains the effect and says it applies immediately', async () => {
    render();
    const dialog = await openDialog();
    expect(field(dialog).value).toBe('vat_payer');
    expect(within(dialog).getByText(EN['changeVatStatus.explanation']!)).toBeInTheDocument();
    expect(within(dialog).getByText(CORE['saveSession.immediateBadge']!)).toBeInTheDocument();
  });

  it('sends only vatStatus and expectedUpdatedAt, then closes, refreshes and says so', async () => {
    let finish: (value: unknown) => void = () => undefined;
    patchSpy.mockImplementation(() => new Promise((r) => (finish = r)));
    render();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: 'reverse_charge' } });
    submit(dialog);
    const submitButton = within(dialog).getByRole('button', { name: EN['changeVatStatus.submit']! });
    await waitFor(() => expect(submitButton).toHaveAttribute('aria-busy', 'true'));
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(patchSpy).toHaveBeenCalledWith(ORG_URL, { vatStatus: 'reverse_charge', expectedUpdatedAt: UPDATED_AT });
    const reads = getSpy.mock.calls.filter(([url]) => url === ORG_URL).length;
    current = { ...COMPANY, vatStatus: 'reverse_charge', updatedAt: '2026-05-01T10:00:00.000Z' };
    finish({ data: current });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(EN['changeVatStatus.success.changed']!)).toBeInTheDocument();
    await waitFor(() => expect(getSpy.mock.calls.filter(([url]) => url === ORG_URL).length).toBeGreaterThan(reads));
    // The header and the Tax tab's tax identity read the new value back (#1515).
    expect(await screen.findAllByText(EN['vatStatus.reverse_charge']!)).toHaveLength(2);
  });

  it('sends nothing when the value is the stored one, and says so', async () => {
    render();
    const dialog = await openDialog();
    submit(dialog);
    expect(await screen.findByText(EN['changeVatStatus.success.unchanged']!)).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('shows a version conflict as an alert in the dialog and reloads the organization', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'Organization was modified.', requestId: 'r' } } as never),
    );
    render();
    const dialog = await openDialog();
    const reads = getSpy.mock.calls.filter(([url]) => url === ORG_URL).length;
    fireEvent.change(field(dialog), { target: { value: 'vat_exempt' } });
    submit(dialog);
    expect(await within(dialog).findByText(EN['changeVatStatus.error.conflict']!)).toBeInTheDocument();
    await waitFor(() => expect(getSpy.mock.calls.filter(([url]) => url === ORG_URL).length).toBeGreaterThan(reads));
  });

  it('shows any other refusal as an alert in the dialog', async () => {
    patchSpy.mockRejectedValue(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Not here.', requestId: 'r' } } as never));
    render();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: 'vat_exempt' } });
    submit(dialog);
    expect(await within(dialog).findByText('Not here.')).toBeInTheDocument();
  });

  it('has no axe violations in the dialog', async () => {
    render();
    const dialog = await openDialog();
    await expectNoAxeViolations(dialog);
  });

  it('has its keys in both bundles', () => {
    const keys = Object.keys(EN).filter((key) => key.startsWith('changeVatStatus.'));
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const key of keys) expect(PL[key], key).toEqual(expect.any(String));
  });
});
