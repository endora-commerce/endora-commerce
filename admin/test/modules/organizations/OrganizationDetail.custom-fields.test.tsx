import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The organization screen still renders its custom fields and still saves them,
 * with the panel resolved from `@endora-commerce/admin-kit/components`
 * (feature 091, P4e).
 *
 * This is the call site whose writer is not a bare endpoint: `save` is the
 * screen's own `handlePatch`, which folds the bag into the organization PATCH
 * together with `expectedUpdatedAt`. `admin-component-contribution.md` §9.1
 * names it as the case that makes the reach *"the host renders its own data"*
 * rather than *"the owner mounts its fragment"* — the panel cannot know about
 * the concurrency field, and after publication it still does not have to.
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

// Ten sibling panels, each with a data chain of its own; none is under test.
//
// **Every spelling is the package's own source, and that is feature 091's
// batch 14 re-keying them rather than tidying them.** They named the `@/`
// alias until that batch, and the screen now imports `../panels/….js` and
// `../components/OrganizationSalesRepsTab.js` from inside
// `@endora-commerce/mod-organizations`, where that alias resolves to nothing —
// so the old spellings would have named files that are gone, and vitest
// answers a mock over a deleted path by making it **inert** rather than by
// failing. All seven panels would have mounted for real against the stubbed
// `apiClient`. `tsc` is what found it, by the dynamic import below.
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
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({
  OrganizationSalesRepsTab: () => null,
}));
// Three more `vi.mock`s stood here until feature 091's P7b, one per module
// panel this screen imported by path: `quick_order`'s `DefaultPreferencesPanel`,
// `sales_channels`' `EntityChannelMembership` and `price_lists`'
// `DisplayModeOverrideRow`. All three are `organization.detail.after`
// contributions now and their `admin/src` copies are deleted, so the mocks
// named modules that no longer exist — and vitest answered that by making them
// **inert** rather than by failing, which is the trap this feature has now
// reported three times. What replaces them is the empty registry below: the
// zone enumerates nothing here, because this file's subject is the custom-field
// panel and not the zone.

const { OrganizationDetail } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail'
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN };

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const UPDATED_AT = '2026-05-01T09:00:00.000Z';

const DEFINITION = {
  id: '00000000-0000-4000-8000-00000000d003',
  entityType: 'organization',
  key: 'account_manager',
  label: { en: 'Account manager' },
  labelDefault: 'Account manager',
  valueType: 'text',
  required: false,
  sortOrder: 0,
  config: {},
  options: [],
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
  registeredAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  orderConfirmationEmails: [],
  fulfilmentStrategy: null,
  fulfilmentStrategyWarehouseOrder: null,
  customFieldValues: { account_manager: 'Ada' },
  parentId: null,
  members: [],
  updatedAt: UPDATED_AT,
};

function renderDetail(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: ORG });
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=organization') {
      return Promise.resolve({ data: [DEFINITION] });
    }
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
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
        // No contribution: `organization.detail.after` renders nothing here, so
        // the four panels that used to be mocked cost this file nothing at all.
        contributions: [],
      },
    ),
    bundle,
  );
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: ORG });
});

describe('OrganizationDetail — custom fields, through the published panel', () => {
  it('renders the panel over the organization\'s own stored bag', async () => {
    renderDetail();

    expect(await screen.findByText(CORE_EN['customFields.title'] as string)).toBeTruthy();
    expect(await screen.findByLabelText('Account manager')).toHaveValue('Ada');
    expect(getSpy.mock.calls.map((call) => call[0])).toContain(
      '/api/v1/admin/custom-fields/definitions?entityType=organization',
    );
  });

  it('saves through the screen\'s own `handlePatch`, concurrency field included', async () => {
    renderDetail();

    const input = await screen.findByLabelText('Account manager');
    await userEvent.clear(input);
    await userEvent.type(input, 'Bea');
    await userEvent.click(
      screen.getByRole('button', { name: CORE_EN['customFields.save'] as string }),
    );

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(`/api/v1/admin/organizations/${ORG_ID}`);
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({
      customFieldValues: { account_manager: 'Bea' },
      expectedUpdatedAt: UPDATED_AT,
    });
  });
});
