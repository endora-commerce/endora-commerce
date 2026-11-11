import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/177-tax-id-scope/` T019 (inventory O14) — a personal Organization has
 * no tax ID (`taxId: null`). The list and the detail header render no tax-ID
 * text for it, and the detail screen leaves out the VAT validation panel: there
 * is nothing to validate, and the backend refuses it (`422`, FR-006).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

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
  VatValidationPanel: () => <section data-testid="vat-validation-panel" />,
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
const { OrganizationsList } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationsList'
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORG_ID = '00000000-0000-4000-8000-0000000000b7';

const COMPANY = {
  id: ORG_ID,
  name: 'Acme',
  legalName: null,
  taxId: '5260250274' as string | null,
  isPersonal: false,
  status: 'active',
  vatStatus: 'vat_payer',
  registeredAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
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

function answer(org: typeof COMPANY): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: org });
    // A company's Roles tab reads its roles; none is what this screen needs.
    if (path.startsWith(`/api/v1/admin/organizations/${ORG_ID}/roles`)) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/organizations')) return Promise.resolve({ data: [org] });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderAt(path: string): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/organizations" element={<OrganizationsList />} />
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['organizations'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
});

describe('Organization detail — a personal Organization has no tax ID (177 O14)', () => {
  it('renders no tax-ID label in the header', async () => {
    answer(PERSONAL);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByText('Personal account')).toBeInTheDocument();
    expect(document.body.querySelector('code.font-mono')).toBeNull();
    expect(document.body.textContent).not.toContain(CORE_EN['organizations.detail.taxIdLabel']!);
  });

  it('leaves out the VAT validation panel', async () => {
    answer(PERSONAL);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByText('Personal account')).toBeInTheDocument();
    expect(screen.queryByTestId('vat-validation-panel')).not.toBeInTheDocument();
  });

  it('keeps the VAT validation panel for a company', async () => {
    answer(COMPANY);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByTestId('vat-validation-panel')).toBeInTheDocument();
  });

  it('renders no tax-ID label for a company row without one, rather than an empty code', async () => {
    answer({ ...COMPANY, taxId: null });
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByTestId('vat-validation-panel')).toBeInTheDocument();
    expect(document.body.querySelector('code.font-mono')).toBeNull();
    expect(document.body.textContent).not.toContain(CORE_EN['organizations.detail.taxIdLabel']!);
  });

  it('shows a company tax ID in the header', async () => {
    answer(COMPANY);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByText('5260250274')).toBeInTheDocument();
  });
});

describe('Organizations list (card layout) — no tax ID (177 O14)', () => {
  beforeEach(() => setMobileViewport(true));

  it('renders "Personal account" and no tax-ID text for a personal Organization', async () => {
    answer(PERSONAL);
    renderAt('/organizations');
    expect(await screen.findByText('Personal account')).toBeInTheDocument();
    expect(document.body.querySelector('.font-mono')).toBeNull();
  });

  it('renders no empty tax-ID element for a company row without one', async () => {
    answer({ ...COMPANY, taxId: null });
    renderAt('/organizations');
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(document.body.querySelector('.font-mono')).toBeNull();
  });
});
