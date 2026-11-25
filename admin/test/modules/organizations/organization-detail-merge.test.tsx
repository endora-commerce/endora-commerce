import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/192-organization-merge/` T074, T076, T077 (FR-051, FR-052, FR-080) —
 * the Organization screen's part of the merge: the action in "More" for a
 * holder of `organizations:merge`, the notice while a merge involving the
 * organization runs, *Merged from …* on the survivor, and the archived
 * loser's read-only screen with its banner.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});
for (const panel of [
  'panels/FulfilmentStrategyPanel',
  'panels/ModerationActionsPanel',
  'panels/ApplicablePriceListsPanel',
  'panels/HierarchyPanel',
  'panels/VatValidationPanel',
  'panels/RestrictionsPanel',
  'panels/SalesChannelsPanel',
  'components/OrganizationSalesRepsTab',
]) {
  vi.doMock(`../../../../packages/modules/organizations/src/admin/${panel}`, () => {
    const name = panel.split('/')[1]!;
    return { [name]: () => null };
  });
}
const { OrganizationDetail } = await import('../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail');

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const EN = read('../packages/modules/organizations/i18n/en.json');
const CORE = read('../packages/modules/_i18n/i18n/en.json');

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const SURVIVOR = '00000000-0000-4000-8000-0000000000b1';
const MERGE = '00000000-0000-4000-8000-0000000000c1';

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
  version: 1,
  updatedAt: '2026-05-01T09:00:00.000Z',
  mergedIntoOrganizationId: null,
  mergedAt: null,
  mergeId: null,
};

const mergeView = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: MERGE,
  hostType: 'organization',
  survivorId: ORG_ID,
  loserId: SURVIVOR,
  state: 'completed',
  version: 2,
  source: null,
  actorKind: 'admin',
  actorAdminUserId: null,
  startedAt: '2026-11-25T10:00:00.000Z',
  completedAt: '2026-11-25T10:05:00.000Z',
  cancelledAt: null,
  needsAttentionAt: null,
  lastErrorCode: null,
  fieldChoices: {},
  customFieldChoices: {},
  steps: [],
  survivorName: 'Acme',
  loserName: 'ACME (import)',
  actorName: 'Anna Nowak',
  ...overrides,
});

function serve(org: Record<string, unknown>, merges: Record<string, unknown>[] = []): void {
  getSpy.mockImplementation(async (url: string) => {
    if (url === `/api/v1/admin/organizations/${ORG_ID}`) return { data: org };
    if (url.startsWith('/api/v1/admin/organization-merges?')) return { data: merges };
    if (url === `/api/v1/admin/organization-merges/${MERGE}`) return { data: merges[0] };
    if (url.includes('/restrictions')) return { data: { paymentMethodIds: [], deliveryMethodIds: [], warehouseIds: [], version: 1 } };
    return { data: [], items: [] };
  });
}

function renderDetail(permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations'] }), contributions: [] },
    ),
    { core: CORE, organizations: EN },
  );
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
});

describe('the Organization screen and the merge', () => {
  it('offers the merge in "More" to a holder of organizations:merge, and opens the flow', async () => {
    serve(ORG);
    renderDetail(['customers:read', 'customers:manage', 'organizations:merge']);
    fireEvent.pointerDown(await screen.findByRole('button', { name: CORE['common.action.more']! }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: EN['merge.action.open']! }));
    expect(await screen.findByRole('dialog', { name: EN['merge.flow.title']! })).toBeInTheDocument();
  });

  it('offers no merge without organizations:merge, and reads no merges', async () => {
    serve(ORG);
    renderDetail(['customers:read', 'customers:manage']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CORE['common.action.more']! })).toBeNull();
    expect(getSpy.mock.calls.some(([url]) => String(url).includes('organization-merges'))).toBe(false);
  });

  it('shows a merge that is running into it, and the organizations merged into it', async () => {
    serve(ORG, [mergeView({}), mergeView({ id: '00000000-0000-4000-8000-0000000000c2', state: 'running', completedAt: null, loserName: 'Acme Two' })]);
    renderDetail(['customers:read', 'organizations:merge']);
    expect(await screen.findByText(EN['merge.notice.survivorRunning']!.replace('{loser}', 'Acme Two'))).toBeInTheDocument();
    expect(screen.getByText(EN['merge.mergedFrom.entry']!.replace('{loser}', 'ACME (import)'))).toBeInTheDocument();
  });

  it('shows an archived organization read-only, with its banner leading to the survivor', async () => {
    serve(
      { ...ORG, mergedIntoOrganizationId: SURVIVOR, mergedAt: '2026-11-25T10:05:00.000Z', mergeId: MERGE },
      [mergeView({ survivorId: SURVIVOR, loserId: ORG_ID, survivorName: 'Acme Holding' })],
    );
    renderDetail(['customers:read', 'customers:manage', 'organizations:merge']);
    expect(await screen.findByText(EN['merge.banner.title']!)).toBeInTheDocument();
    expect((await screen.findByRole('link', { name: 'Acme Holding' })).getAttribute('href')).toBe(`/organizations/${SURVIVOR}`);
    expect(screen.getByText(EN['merge.banner.archivedBadge']!)).toBeInTheDocument();
    // Read-only: no Save, no tabs, no "More".
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: CORE['common.action.more']! })).toBeNull();
  });
});
