import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `price_lists` contributes two zones (feature 091, P7a; FR-007).
 *
 * ## The defect this replaces
 *
 * `catalog`'s `CategoriesTree.tsx` imported `DisplayModeOverrideRow` and its
 * `ProductEditor.tsx` imported `LinkedPriceListsPanel`, both out of
 * `admin/src/modules/price_lists/` — two of the three admin keys in
 * `backend/scripts/ledgers/cross-module-imports/catalog.ts`, whose recorded
 * retiring condition is *"the owner declaring an admin contribution zone"*.
 * `catalog` now renders `category.editor.after` and
 * `product.editor.pricing.after`; this module declares the other end.
 *
 * ## Why the registry is real and the declarations are imported
 *
 * A contribution asserted against a copy of itself asserts nothing about the
 * declaration a bundler will read, so the entry below is this package's own
 * `contributions` object off its `./admin` subpath and the mount is the real
 * `<AdminZone>` over the real provider. A zone name, a weight or a
 * `requiredPermission` that drifts fails here.
 *
 * ## Three cases, not four, and the missing one is asserted rather than skipped
 *
 * `price_lists` declares `activation.nonDeactivatable`, so it has no off state
 * for a test to drive (`plan.md` Ruling 2). The lock is read from the manifest
 * below; the axis this module does have — the permission — takes the other
 * three.
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

const priceLists = await import('@endora-commerce/mod-price-lists/admin');
const { manifest } = await import('@endora-commerce/mod-price-lists');

const CATEGORY_ID = '33333333-3333-4333-8333-333333333303';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';

const REGISTRY = [{ moduleId: 'price_lists', contributions: priceLists.contributions }];

const BUNDLE = passthroughBundle('core', [
  'priceLists.displayMode.rowLabel',
  'priceLists.displayMode.inherit',
  'priceLists.displayMode.grossOnly',
  'priceLists.displayMode.netOnly',
  'priceLists.displayMode.both',
  'priceLists.displayMode.none',
  'priceLists.displayMode.savedSuffix',
  'priceLists.linked.loading',
  'priceLists.linked.error.load',
  'priceLists.linked.emptyTitle',
  'priceLists.linked.emptyDescription',
  'priceLists.linked.helpText',
]);

function renderZone(options: {
  readonly name: AdminZoneName;
  readonly props: Record<string, unknown>;
  readonly permissions?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/x']}>
        {/* `AdminZone` is generic on the literal name at a host's call site;
            this helper is generic over the two members this module serves, so
            the cast is the harness's and not a host's. */}
        <AdminZone
          name={options.name as 'product.editor.pricing.after'}
          props={options.props as { productId: string }}
        />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['price_lists:read'])] }),
        presence: modulePresence({ present: ['price_lists'] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('price_lists contributes the category and pricing zones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/display-mode-overrides/')) return { data: { mode: 'inherit' } };
      if (url.includes('/price-lists')) return { data: { items: [] } };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares exactly the two members P7a adds, with no match on either', () => {
    // `match` narrows the *mounts of one place* (Z13). Each of these members
    // has one host and one mount, so a `match` here could only ever be an
    // enumeration of another module's vocabulary — asserted absent so a later
    // author cannot add one quietly.
    const zones = priceLists.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual([
      'category.editor.after',
      'product.editor.pricing.after',
    ]);
    for (const zone of zones) {
      expect(zone.match, zone.zone).toBeUndefined();
      expect(zone.requiredPermission, zone.zone).toBe('price_lists:read');
      // FR-013: the chunk sits behind a factory the renderer reaches only after
      // it has decided presence and permission.
      expect(typeof zone.component, zone.zone).toBe('function');
    }
  });

  it('renders the display-mode row into the category editor zone', async () => {
    const container = renderZone({
      name: 'category.editor.after',
      props: { categoryId: CATEGORY_ID },
    });
    await waitFor(() =>
      expect(container.textContent).toContain('priceLists.displayMode.rowLabel'),
    );
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/pricing/display-mode-overrides/category/${CATEGORY_ID}`,
    );
  });

  it('renders the linked price lists panel into the pricing zone', async () => {
    const container = renderZone({
      name: 'product.editor.pricing.after',
      props: { productId: PRODUCT_ID },
    });
    await waitFor(() => expect(container.textContent).toContain('priceLists.linked.emptyTitle'));
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/products/${PRODUCT_ID}/price-lists`,
    );
  });

  it('renders neither zone without price_lists:read, and fetches no chunk', async () => {
    // Both endpoints are behind `requireAdmin('price_lists:read')`, and the
    // renderer applies the declared code before it touches `React.lazy` — so an
    // operator who cannot read pricing downloads neither contribution.
    const category = renderZone({
      name: 'category.editor.after',
      props: { categoryId: CATEGORY_ID },
      permissions: ['catalog:write'],
    });
    const pricing = renderZone({
      name: 'product.editor.pricing.after',
      props: { productId: PRODUCT_ID },
      permissions: ['catalog:write'],
    });
    await waitFor(() => expect(category.textContent).toBe(''));
    expect(pricing.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores both zones when the permission comes back', async () => {
    const container = renderZone({
      name: 'product.editor.pricing.after',
      props: { productId: PRODUCT_ID },
      permissions: ['price_lists:read'],
    });
    await waitFor(() => expect(container.textContent).toContain('priceLists.linked.emptyTitle'));
  });

  it('leaves neither host naming this module in its own source', async () => {
    // The evidence that the conversion converted something: the two entries in
    // `cross-module-imports/catalog.ts` retire on the host screens no longer
    // importing this module's components, and `check:admin-zones` is what
    // refuses a member no host renders.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const tree = readFileSync(
      resolve(process.cwd(), 'src/modules/catalog/CategoriesTree.tsx'),
      'utf8',
    );
    expect(tree).not.toContain('DisplayModeOverrideRow');
    expect(tree).toContain("useAdminZone('category.editor.after'");
    expect(tree).toContain('name="category.editor.after"');
    // The two `catalog` strings that used to cross the seam as props.
    expect(tree).not.toContain('categories.priceDisplayMode');
  });

  it('has no off state to drive, and says so from its own manifest', () => {
    // Ruling 2: the fourth case is missing because the platform refuses to have
    // it. Read from the manifest rather than skipped, so a module that stops
    // being locked fails here instead of quietly losing a case.
    expect(manifest.activation).toEqual(
      expect.objectContaining({ nonDeactivatable: true }),
    );
  });
});
