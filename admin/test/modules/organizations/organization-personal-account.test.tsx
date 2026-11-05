import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #767, owner ruling of 2026-11-05 — a personal (B2C) Organization's tax
 * id is an internal 32-hex placeholder, so the Organizations list and the
 * Organization detail header show "Personal account" in its place. A company
 * Organization keeps its tax id.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

// The detail screen's sibling panels each pull a data chain of their own; none is under test.
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
const { OrganizationsList } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationsList'
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const PLACEHOLDER_TAX_ID = '79963f233e3843bd84e144a8fcdd37f8';

const COMPANY = {
  id: ORG_ID,
  name: 'Acme',
  legalName: null,
  taxId: '5260250274',
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
const PERSONAL = { ...COMPANY, name: 'Jan Kowalski', taxId: PLACEHOLDER_TAX_ID, isPersonal: true, vatStatus: 'vat_exempt' };

function answer(org: typeof COMPANY): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: org });
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
  patchSpy.mockReset();
});

describe('Organization detail header — tax id or personal account (#767)', () => {
  it("shows a company Organization's tax id", async () => {
    answer(COMPANY);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByText('5260250274')).toBeInTheDocument();
    expect(screen.queryByText('Personal account')).not.toBeInTheDocument();
  });

  it('shows "Personal account" instead of a personal Organization\'s placeholder', async () => {
    answer(PERSONAL);
    renderAt(`/organizations/${ORG_ID}`);
    expect(await screen.findByText('Personal account')).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER_TAX_ID)).not.toBeInTheDocument();
  });
});

// The list prints the tax id under the name in its card layout, which is the
// narrow viewport's; the wide table has no tax-id column.
describe('Organizations list (card layout) — tax id or personal account (#767)', () => {
  beforeEach(() => setMobileViewport(true));

  it("shows a company Organization's tax id", async () => {
    answer(COMPANY);
    renderAt('/organizations');
    expect(await screen.findByText('5260250274')).toBeInTheDocument();
    expect(screen.queryByText('Personal account')).not.toBeInTheDocument();
  });

  it('shows "Personal account" instead of a personal Organization\'s placeholder', async () => {
    answer(PERSONAL);
    renderAt('/organizations');
    expect(await screen.findByText('Personal account')).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER_TAX_ID)).not.toBeInTheDocument();
  });
});
