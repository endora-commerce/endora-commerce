import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * Issue #698 — the admin Organization routes answer an Organization assigned
 * to another sales representative with `404 NOT_FOUND`, as one that does not
 * exist. The list still shows it (spec 150 owner Q2), so a representative can
 * open its row; the detail screen then shows its ordinary not-found state
 * rather than a load error (architect ruling on PR #847: the accepted side
 * effect until the owner rules on what a representative's list holds).
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

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

function renderDetail(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['customers:read', 'customers:manage'] }),
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

describe('Organization detail — an Organization outside the representative\'s reach (#698)', () => {
  it('shows the not-found state, not a load error, for a 404 NOT_FOUND', async () => {
    getSpy.mockImplementation(() =>
      Promise.reject(
        new ApiError(404, { error: { code: 'NOT_FOUND', message: 'Organization not found.', requestId: 'req_698' } }),
      ),
    );
    renderDetail();
    expect(await screen.findByText(CORE_EN['organizations.detail.notFound']!)).toBeInTheDocument();
    expect(screen.queryByText(CORE_EN['organizations.detail.error.load']!)).not.toBeInTheDocument();
  });
});
