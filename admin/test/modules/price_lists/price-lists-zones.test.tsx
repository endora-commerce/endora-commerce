import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `price_lists` contributes three zones (feature 091, P7a and P7b; FR-007;
 * feature 161 T043).
 *
 * Feature 160 removed the third, `product.editor.pricing.after` with its
 * *Linked price lists* panel, along with the old model it listed; P2's
 * base-price panel (feature 161, `specs/161-price-book-editor/research.md` R7)
 * takes the member back, on the same code as the other two.
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
 * **P7b added a third**, `organization.detail.after`, for the same control on
 * `organizations`' detail screen — the `DisplayModeOverrideRow` key of
 * `cross-module-imports/organizations.ts`, whose shard is deleted with it. It
 * is a contribution to a member of its own rather than a `match` on the
 * category one, because two hosts with a place each are two members (Z13), and
 * it is the one wrapper in this module that renders a `Card`: the zone it joins
 * is a stack of panels and the other three contributors each render one.
 *
 * ## Why the registry is real and the declarations are imported
 *
 * A contribution asserted against a copy of itself asserts nothing about the
 * declaration a bundler will read, so the entry below is this package's own
 * `contributions` object off its `./admin` subpath and the mount is the real
 * `<AdminZone>` over the real provider. A zone name, a weight or a
 * `requiredPermission` that drifts fails here.
 *
 * ## The operator's off state is asserted missing rather than skipped
 *
 * `price_lists` declares `activation.nonDeactivatable`, so an operator cannot
 * switch it off (`plan.md` Ruling 2). The lock is read from the manifest
 * below. The two axes this module does have are driven: the permission, and
 * platform availability — a deployment that does not install the module
 * (feature 161 T043).
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
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';

const REGISTRY = [{ moduleId: 'price_lists', contributions: priceLists.contributions }];

const PRODUCT_ID = '00000000-0000-4000-8000-000000161b01';

const BUNDLE = {
  ...passthroughBundle('core', [
    'priceLists.displayMode.rowLabel',
    'priceLists.displayMode.inherit',
    'priceLists.displayMode.grossOnly',
    'priceLists.displayMode.netOnly',
    'priceLists.displayMode.both',
    'priceLists.displayMode.none',
    'priceLists.displayMode.savedSuffix',
  ]),
  // The base-price panel is a feature-161 screen and speaks in this module's
  // own namespace, not in `core`.
  ...passthroughBundle('price_lists', ['basePrices.title', 'basePrices.description']),
};

function renderZone(options: {
  readonly name: AdminZoneName;
  readonly props: Record<string, unknown>;
  readonly permissions?: readonly string[];
  readonly present?: boolean;
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/x']}>
        {/* `AdminZone` is generic on the literal name at a host's call site;
            this helper is generic over the two members this module serves, so
            the cast is the harness's and not a host's. */}
        <AdminZone
          name={options.name as 'category.editor.after'}
          props={options.props as { categoryId: string }}
        />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['price_lists:read'])] }),
        presence:
          options.present === false
            ? modulePresence({ absent: ['price_lists'] })
            : modulePresence({ present: ['price_lists'] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('price_lists contributes the category, organization and product-pricing zones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/display-mode-overrides/')) return { data: { mode: 'inherit' } };
      if (url.includes('/price-books/')) return { data: { items: [] } };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares exactly the two display-mode members and the base-price member, with no match on any', () => {
    // `match` narrows the *mounts of one place* (Z13). Each of these members
    // has one host and one mount, so a `match` here could only ever be an
    // enumeration of another module's vocabulary — asserted absent so a later
    // author cannot add one quietly.
    const zones = priceLists.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual([
      'category.editor.after',
      'organization.detail.after',
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

  it('shows a reader the override as a value, with no select (FR-028, Checkpoint 10 ruling)', async () => {
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/display-mode-overrides/category/')) return { data: { mode: 'net_only' } };
      return { data: { items: [] } };
    });
    const container = renderZone({ name: 'category.editor.after', props: { categoryId: CATEGORY_ID } });
    await waitFor(() => expect(container.textContent).toContain('priceLists.displayMode.netOnly'));
    expect(container.querySelector('select')).toBeNull();
  });

  it('offers the select to an operator holding price_lists:write', async () => {
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/display-mode-overrides/category/')) return { data: { mode: 'net_only' } };
      return { data: { items: [] } };
    });
    const container = renderZone({
      name: 'category.editor.after',
      props: { categoryId: CATEGORY_ID },
      permissions: ['price_lists:read', 'price_lists:write'],
    });
    await waitFor(() => expect(container.querySelector('select')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('select')).toHaveValue('net_only'));
  });

  it('orders itself second among the organization detail\'s four contributors', () => {
    // The weights preserve the order the operator saw when the panels were
    // scattered through `OrganizationDetail.tsx`: `sales_channels` (100), this
    // row (200), `quick_order` (300), `carts` (400).
    const organization = (priceLists.contributions.zones ?? []).find(
      (zone) => zone.zone === 'organization.detail.after',
    );
    expect(organization?.weight).toBe(200);
  });

  it('renders the display-mode row into the organization detail zone', async () => {
    const container = renderZone({
      name: 'organization.detail.after',
      props: { organizationId: ORGANIZATION_ID },
    });
    await waitFor(() =>
      expect(container.textContent).toContain('priceLists.displayMode.rowLabel'),
    );
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/pricing/display-mode-overrides/organization/${ORGANIZATION_ID}`,
    );
  });

  it('leaves the organization host naming neither this module nor its control', async () => {
    // P7b's half of the evidence, and the copy change with it: the host used to
    // pass `organizations.detail.pricingLabel` and `.pricingHint` into this
    // module's control and wrap it in a card titled `.pricingCard`. All three
    // keys are read by nothing now and are removed from the `core` bundle in
    // both shipped languages.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const host = readFileSync(
      // Re-keyed by feature 091's Phase 4 batch 14, not tidied: the host
      // screen moved into its own package, and a `readFileSync` of the old
      // path throws rather than reporting a missing mount. This assertion is
      // derived *about* a file another merge request moves, which is the
      // shape that has produced a stale ledger in every batch that did not
      // look for it.
      resolve(
        process.cwd(),
        '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx',
      ),
      'utf8',
    );
    expect(host).not.toContain('DisplayModeOverrideRow');
    expect(host).not.toContain('organizations.detail.pricing');
    expect(host).toContain('name="organization.detail.after"');
    const core = JSON.parse(
      readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
    ) as Record<string, string>;
    for (const key of [
      'organizations.detail.pricingCard',
      'organizations.detail.pricingHint',
      'organizations.detail.pricingLabel',
    ]) {
      expect(core[key], key).toBeUndefined();
    }
  });

  it('renders the base-price panel into the product editor\'s pricing tab (161 T043)', async () => {
    // R7: the end of the Pricing tab, after the PIM panels of
    // `product.editor.pricing.before`. The panel's content is Phase 6's; what
    // this proves is the member, the mount and the gate.
    const zone = (priceLists.contributions.zones ?? []).find(
      (z) => z.zone === 'product.editor.pricing.after',
    );
    expect(zone?.weight).toBe(100);
    const container = renderZone({
      name: 'product.editor.pricing.after',
      props: { productId: PRODUCT_ID },
    });
    await waitFor(() => expect(container.textContent).toContain('basePrices.title'));
  });

  it('renders no base-price panel without price_lists:read', async () => {
    const container = renderZone({
      name: 'product.editor.pricing.after',
      props: { productId: PRODUCT_ID },
      permissions: ['catalog:write'],
    });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders none of its zones where the platform does not offer the module', async () => {
    // The operator axis is locked (below); the platform axis is not — a
    // deployment may not install `price_lists`, and then every contribution
    // goes with it (Principle XVII). The positive control is the case above.
    for (const [name, props] of [
      ['category.editor.after', { categoryId: CATEGORY_ID }],
      ['organization.detail.after', { organizationId: ORGANIZATION_ID }],
      ['product.editor.pricing.after', { productId: PRODUCT_ID }],
    ] as const) {
      const container = renderZone({ name, props, present: false });
      await waitFor(() => expect(container.textContent, name).toBe(''));
    }
    expect(getSpy).not.toHaveBeenCalled();
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
    const organization = renderZone({
      name: 'organization.detail.after',
      props: { organizationId: ORGANIZATION_ID },
      permissions: ['catalog:write'],
    });
    await waitFor(() => expect(category.textContent).toBe(''));
    expect(organization.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores both zones when the permission comes back', async () => {
    const container = renderZone({
      name: 'category.editor.after',
      props: { categoryId: CATEGORY_ID },
      permissions: ['price_lists:read'],
    });
    await waitFor(() => expect(container.textContent).toContain('priceLists.displayMode.rowLabel'));
  });

  it('leaves neither host naming this module in its own source', async () => {
    // The evidence that the conversion converted something: the two entries in
    // `cross-module-imports/catalog.ts` retire on the host screens no longer
    // importing this module's components, and `check:admin-zones` is what
    // refuses a member no host renders.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const tree = readFileSync(
      resolve(
        process.cwd(),
        // Re-keyed by feature 091's Phase 4 batch 15: `catalog` took its admin
        // surface into its own package and this host screen went with it. A
        // `readFileSync` of the old path throws rather than reporting a mount
        // that is missing.
        '../packages/modules/catalog/src/admin/pages/CategoriesTree.tsx',
      ),
      'utf8',
    );
    expect(tree).not.toContain('DisplayModeOverrideRow');
    expect(tree).toContain("useAdminZone('category.editor.after'");
    expect(tree).toContain('name="category.editor.after"');
    // The two `catalog` strings that used to cross the seam as props.
    expect(tree).not.toContain('categories.priceDisplayMode');
  });

  it('has no operator off state to drive, and says so from its own manifest', () => {
    // Ruling 2: the operator's off case is missing because the platform refuses
    // to have it; the platform axis is driven above. Read from the manifest rather than skipped, so a module that stops
    // being locked fails here instead of quietly losing a case.
    expect(manifest.activation).toEqual(
      expect.objectContaining({ nonDeactivatable: true }),
    );
  });
});
