import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * The product create affordance is gated on the code its destination takes
 * (D-221).
 *
 * ## What this file exists to refuse
 *
 * A tightening that becomes a hidden refusal. `/catalog/products/new` is a
 * declared route on `catalog:write` since D-221, and `ModuleRoute` renders the
 * admin's own not-found treatment for a route the operator's codes do not
 * satisfy — so a *New product* button left ungated would send a role holding
 * `catalog:read` alone to a page that says nothing about permissions. That is
 * strictly worse than the state before the ruling, where the same role reached
 * a form and was refused on save: the dead end would have moved from the save
 * to the router and taken the explanation with it.
 *
 * So the assertion is **absence**, in both places `ProductsList` offers the
 * create: the page-head button and the empty-state link. Neither is disabled
 * and neither renders a refusal panel — that is the treatment `inventory`'s
 * gating test argues for at length and the one every module-owned list already
 * uses (`blog`, `cms`, `sales_channels` all render `null`).
 *
 * ## Why a rendering test and not a source assertion
 *
 * `admin/test/modules/batch-fifteen-surfaces.module-owned-surface.test.tsx`
 * asserts the **route** declaration and
 * `backend/test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`
 * asserts the **palette** pairing. Neither can see whether the button moved
 * with the route, because neither renders this screen — and a `grep` for
 * `canWrite` would pass over a component that computes it and ignores it. The
 * gate is driven through the real `AuthProvider`, so what is under test is
 * `hasPermission` and not a stub of it (feature 091's P3 reasoning).
 *
 * The four cases are the two affordances times the two roles, because a single
 * "read-only sees nothing" case passes just as well against a screen that
 * renders nothing at all.
 */

const getSpy = vi.fn();

// Mocked at the **kit's** barrel, which is where a packaged screen resolves its
// client from. `@/lib/api-client` is only a re-export shim, so the old spelling
// intercepts nothing and vitest reports that by making the mock inert rather
// than by failing — batch 15's trap, recorded in this directory's siblings.
//
// `usePageSizePreference` is folded into the same factory rather than kept
// beside it: two `vi.mock` calls naming one module are one module mocked twice,
// with the last factory silently replacing the first.
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
    PAGE_SIZE_OPTIONS: [5, 10, 20, 50, 100, 500] as const,
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/ProductsList'
);

const BUNDLE = passthroughBundle('catalog', [
  'productsList.title',
  'productsList.subtitle',
  'productsList.action.import',
  'productsList.action.export',
  'productsList.action.newProduct',
  'productsList.loading',
  'productsList.empty.title',
  'productsList.empty.prefix',
  'productsList.empty.button',
  'productsList.empty.suffix',
  'productsList.empty.readOnly',
  'productsList.column.product',
  'productsList.column.sku',
  'productsList.column.status',
  'productsList.column.type',
  'productsList.column.visibility',
  'productsList.column.updated',
  'productsList.chip.type',
  'productsList.chip.stock',
  'productsList.chip.category',
  'productsList.chip.channel',
  'productsList.search.placeholder',
  'productsList.tab.all',
  'productsList.tab.active',
  'productsList.tab.draft',
  'productsList.tab.inactive',
  'productsList.error.load',
]);

const ONE_ROW = {
  data: [
    {
      id: '00000000-0000-4000-8000-000000000c01',
      sku: 'GATE-SKU',
      slug: 'gate-sku',
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Gated widget' },
      visibility: 'public',
      attributeValues: {},
      updatedAt: '2026-09-08T10:00:00.000Z',
    },
  ],
  pagination: { page: 0, pageSize: 25, total: 1 },
  counts: { all: 1, active: 1, draft: 0, inactive: 0 },
};

const NO_ROWS = {
  data: [],
  pagination: { page: 0, pageSize: 25, total: 0 },
  counts: { all: 0, active: 0, draft: 0, inactive: 0 },
};

function mount(permissions: readonly string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <ProductsList />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    BUNDLE,
  );
}

describe('the page-head create affordance', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockResolvedValue(ONE_ROW);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is absent for a role holding catalog:read alone', async () => {
    mount(['catalog:read']);

    // The screen itself renders — the absence below is the gate's answer and
    // not a page that failed to mount, which is the way this case would
    // otherwise pass for the wrong reason.
    await screen.findByText('Gated widget');
    expect(screen.queryByText('productsList.action.newProduct')).toBeNull();
    // Absent, not disabled: nothing on this screen offers the destination at
    // all, so the operator never reaches `ModuleRoute`'s not-found page.
    expect(screen.queryByRole('button', { name: /newProduct/ })).toBeNull();
  });

  it('is present for a role holding catalog:write as well', async () => {
    mount(['catalog:read', 'catalog:write']);

    await screen.findByText('Gated widget');
    expect(screen.getByText('productsList.action.newProduct')).toBeInTheDocument();
  });
});

describe('the empty-state create affordance', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockResolvedValue(NO_ROWS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('degrades to advice for a role holding catalog:read alone', async () => {
    mount(['catalog:read']);

    await screen.findByText('productsList.empty.title');
    expect(screen.queryByText('productsList.empty.button')).toBeNull();
    // The sentence the button sat inside goes with it, rather than rendering as
    // *"Try clearing filters, or use  to create one."* — the half of the advice
    // that survives is its own key.
    expect(screen.queryByText('productsList.empty.prefix')).toBeNull();
    expect(screen.getByText('productsList.empty.readOnly')).toBeInTheDocument();
  });

  it('offers the create for a role holding catalog:write', async () => {
    mount(['catalog:read', 'catalog:write']);

    await screen.findByText('productsList.empty.title');
    expect(screen.getByText('productsList.empty.button')).toBeInTheDocument();
    expect(screen.queryByText('productsList.empty.readOnly')).toBeNull();
  });
});
