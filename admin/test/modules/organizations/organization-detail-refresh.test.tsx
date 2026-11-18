import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1496 (UX audit SALES-06, on DS-14 #1447) — the organization screen's
 * re-reads after an invite, a member change or a panel's `onChanged` used to set
 * the full-page loading state (only some callers passed `quiet`), unmounting
 * every panel. Now the first load is a skeleton, every re-read keeps the page,
 * marked `aria-busy`, and a first load that fails offers a retry.
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
// The moderation panel stands in for every panel that reports a change: its
// button calls the `onChanged` the screen hands it.
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel', () => ({
  ModerationActionsPanel: ({ onChanged }: { onChanged: () => void }) => (
    <button type="button" onClick={(): void => onChanged()}>
      moderate
    </button>
  ),
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

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORG_ID = '00000000-0000-4000-8000-0000000000b7';

const ORG = {
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

function answer(readOrg: () => Promise<unknown>): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return readOrg();
    if (path.startsWith(`/api/v1/admin/organizations/${ORG_ID}/roles`)) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
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

describe('Organization detail — first load and refresh (SALES-06)', () => {
  it('shows a busy skeleton region on the first load', async () => {
    let release!: () => void;
    answer(() => new Promise((resolve) => (release = () => resolve({ data: ORG }))));
    renderDetail();

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent(CORE_EN['organizations.loading']!);

    release();
    expect(await screen.findByRole('button', { name: 'moderate' })).toBeInTheDocument();
  });

  it('keeps every panel mounted and busy while a panel\'s change re-reads the organization', async () => {
    const reads: Array<(value: unknown) => void> = [];
    answer(() => new Promise((resolve) => reads.push(resolve)));
    renderDetail();
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ data: ORG });
    const panelButton = await screen.findByRole('button', { name: 'moderate' });

    await userEvent.click(panelButton);

    await waitFor(() => expect(reads).toHaveLength(2));
    expect(panelButton).toBeInTheDocument();
    expect(panelButton.closest('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="detail-skeleton"]')).toBeNull();

    reads[1]!({ data: ORG });
    await waitFor(() => expect(panelButton.closest('[aria-busy="true"]')).toBeNull());
    expect(panelButton).toBeInTheDocument();
  });

  it('a first load that fails is an error with a retry', async () => {
    let attempt = 0;
    answer(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: ORG });
    });
    renderDetail();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(CORE_EN['organizations.detail.error.load']!);
    expect(screen.queryByText(CORE_EN['organizations.detail.notFound']!)).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: CORE_EN['common.action.retry']! }));
    expect(await screen.findByRole('button', { name: 'moderate' })).toBeInTheDocument();
  });
});
