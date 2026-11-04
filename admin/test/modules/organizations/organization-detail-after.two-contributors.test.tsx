import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminComponentFactory, AdminZoneContribution } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `<AdminZone>`'s per-contributor presence gate in its **two-contributor** form, over
 * real declarations (feature 134, T114; `contracts/extraction-procedure.md` W2.3,
 * `research.md` D13 §4).
 *
 * ## Why this file exists
 *
 * Two real declarations in one zone, one switched off and the other still rendered, is
 * a member of the mechanism of its own: a gate that withdrew the whole zone, or the
 * wrong contributor, passes every single-contributor test. Its last driver was the
 * `pim_pimcore` half of `admin/test/modules/pim_ergonode/field-protection-zone.test.tsx`,
 * removed by `039e78c67`, and that file's header records the premise that
 * `product.editor.*` is the only multi-contributor zone over real declarations. The
 * premise is false: `organization.detail.after` has several free contributors —
 * `price_lists` (200) and `quick_order` (300) among them — each tested alone
 * by its own zone file and none mounted beside another.
 *
 * W2.3 refuses deleting the last driver of a mechanism member, so this is the surviving
 * driver `pim_ergonode`'s extraction names: `quick_order`, which is switchable, beside a
 * contributor that is not. That was `sales_channels` (100) until feature 154 withdrew its
 * contribution here — `organizations` edits an Organization's channels in a panel of its
 * own — then `carts` (400), until `specs/170-organization-roles/` (OR-3) removed its
 * cart-approval policy panel with the policy; it is `price_lists` (200) since: also
 * `nonDeactivatable`, and weighted apart from `quick_order`, so the weight-order case
 * still has two weights to order. The registry lists `quick_order` first, so the order
 * the panels render in has to come from the weights.
 *
 * ## What is real and what is instrumented
 *
 * The declarations are each package's own `contributions`, imported from its `./admin`
 * subpath — zone, weight and `requiredPermission` are the ones a bundler reads, and
 * drift in any of them fails here. The one thing wrapped is each `component` factory,
 * in a pass-through that records the call, because *"fetches no chunk"* is a claim about
 * that factory and not about the network. The wrappers are built afresh per render:
 * `<AdminZone>` caches one `lazy()` per factory identity, so a wrapper shared across
 * renders would be loaded once and could not be counted again.
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
const { manifest: priceListsManifest } = await import('@endora-commerce/mod-price-lists');
const carts = await import('@endora-commerce/mod-carts/admin');
const quickOrder = await import('@endora-commerce/mod-quick-order/admin');
const { manifest: quickOrderManifest } = await import('@endora-commerce/mod-quick-order');

const ZONE = 'organization.detail.after';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

/** The text each panel renders first, through a passthrough bundle. */
const PRICE_LISTS_PANEL = 'priceLists.displayMode.rowLabel';
const QUICK_ORDER_PANEL = 'defaultPreferences.title';

const BUNDLE = {
  price_lists: Object.fromEntries(['explainer.entry.organization'].map((key) => [key, key])),
  core: Object.fromEntries(
    [
      'priceLists.displayMode.rowLabel',
      'priceLists.displayMode.inherit',
      'priceLists.displayMode.grossOnly',
      'priceLists.displayMode.netOnly',
      'priceLists.displayMode.both',
      'priceLists.displayMode.none',
      'priceLists.displayMode.savedSuffix',
      'defaultPreferences.title',
      'defaultPreferences.description',
      'defaultPreferences.paymentMethod',
      'defaultPreferences.deliveryMethod',
      'defaultPreferences.billingAddress',
      'defaultPreferences.shippingAddress',
      'defaultPreferences.inherit',
      'defaultPreferences.none',
      'defaultPreferences.save',
      'defaultPreferences.saved',
      'defaultPreferences.saveError',
      'defaultPreferences.loadError',
      'common.state.loading',
    ].map((key) => [key, key]),
  ),
};

function zoneOf(
  moduleId: string,
  zones: readonly AdminZoneContribution[] | undefined,
): AdminZoneContribution {
  const found = (zones ?? []).filter((zone) => zone.zone === ZONE);
  expect(found, `${moduleId} declares ${ZONE} exactly once`).toHaveLength(1);
  return found[0]!;
}

/**
 * The registry, with every factory wrapped in a recorder. `quick_order` is listed
 * **first** on purpose: the order the panels render in must then come from the weights
 * and not from the registry, and not from the module-id tie-break either, which would
 * also put `quick_order` first.
 */
function instrumentedRegistry(): {
  readonly entries: {
    readonly moduleId: string;
    readonly contributions: { readonly zones: readonly AdminZoneContribution[] };
  }[];
  readonly loads: Map<string, number>;
} {
  const loads = new Map<string, number>();
  const wrap = (moduleId: string, zones: readonly AdminZoneContribution[] | undefined) =>
    (zones ?? []).map((zone) => {
      const load: AdminComponentFactory = () => {
        loads.set(moduleId, (loads.get(moduleId) ?? 0) + 1);
        return zone.component();
      };
      return { ...zone, component: load };
    });
  return {
    entries: [
      { moduleId: 'quick_order', contributions: { zones: wrap('quick_order', quickOrder.contributions.zones) } },
      { moduleId: 'price_lists', contributions: { zones: wrap('price_lists', priceLists.contributions.zones) } },
    ],
    loads,
  };
}

function renderZone(options: {
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): { readonly container: HTMLElement; readonly loads: Map<string, number>; unmount(): void } {
  const registry = instrumentedRegistry();
  const { container, unmount } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <AdminZone name={ZONE} props={{ organizationId: ORG_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: registry.entries,
      },
    ),
    BUNDLE,
  );
  return { container, loads: registry.loads, unmount };
}

const BOTH_PERMISSIONS = ['price_lists:read', 'orders:write'] as const;
const BOTH_PRESENT = ['price_lists', 'quick_order'] as const;

const quickOrderRequests = (): unknown[] =>
  getSpy.mock.calls
    .map((call) => call[0])
    .filter((url) => typeof url === 'string' && url.startsWith('/api/v1/admin/quick-order/'));

async function bothRenderedInWeightOrder(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.textContent).toContain(PRICE_LISTS_PANEL);
    expect(container.textContent).toContain(QUICK_ORDER_PANEL);
  });
  const text = container.textContent ?? '';
  expect(text.indexOf(PRICE_LISTS_PANEL)).toBeLessThan(text.indexOf(QUICK_ORDER_PANEL));
}

describe('organization.detail.after — two real contributors, one switchable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/display-mode-overrides/')) return { data: { mode: 'inherit' } };
      if (url.startsWith('/api/v1/admin/quick-order/preferences')) return { data: null };
      if (url.includes('/addresses')) return { data: [] };
      if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [] };
      if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [] };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('has the population this file depends on — one locked contributor, one switchable, weights apart', () => {
    // Read from the real manifests and declarations, so a change to either axis or to
    // the order re-opens the question this driver answers instead of passing over it.
    expect(priceListsManifest.activation).toEqual(expect.objectContaining({ nonDeactivatable: true }));
    expect(quickOrderManifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'quick_order.enabled' }),
    );

    const locked = zoneOf('price_lists', priceLists.contributions.zones);
    const quick = zoneOf('quick_order', quickOrder.contributions.zones);
    expect(locked.requiredPermission).toBe('price_lists:read');
    expect(quick.requiredPermission).toBe('orders:write');
    expect(locked.weight).toBeLessThan(quick.weight);
  });

  it('no longer has carts among its contributors: the cart-approval policy panel is gone (170, OR-3)', () => {
    // `specs/170-organization-roles/` WP-04, T071 — approval is a role's
    // `carts.order_without_approval` now; there is no Organization switch to show.
    expect((carts.contributions.zones ?? []).filter((zone) => zone.zone === ZONE)).toEqual([]);
  });

  it('renders both panels, in weight order, each chunk loaded once', async () => {
    const { container, loads } = renderZone({
      permissions: BOTH_PERMISSIONS,
      present: BOTH_PRESENT,
    });
    await bothRenderedInWeightOrder(container);
    expect(Object.fromEntries(loads)).toEqual({ price_lists: 1, quick_order: 1 });
  });

  it('withdraws only the quick_order panel while it is switched off, and fetches no chunk of it', async () => {
    const { container, loads } = renderZone({
      permissions: BOTH_PERMISSIONS,
      present: ['price_lists'],
    });
    await waitFor(() => expect(container.textContent).toContain(PRICE_LISTS_PANEL));
    expect(container.textContent).not.toContain(QUICK_ORDER_PANEL);
    expect(loads.get('quick_order')).toBeUndefined();
    expect(loads.get('price_lists')).toBe(1);
    expect(quickOrderRequests()).toEqual([]);
  });

  it('withdraws only the quick_order panel without orders:write, and fetches no chunk of it', async () => {
    const { container, loads } = renderZone({
      permissions: ['price_lists:read'],
      present: BOTH_PRESENT,
    });
    await waitFor(() => expect(container.textContent).toContain(PRICE_LISTS_PANEL));
    expect(container.textContent).not.toContain(QUICK_ORDER_PANEL);
    expect(loads.get('quick_order')).toBeUndefined();
    expect(loads.get('price_lists')).toBe(1);
    expect(quickOrderRequests()).toEqual([]);
  });

  it('puts the quick_order panel back in its place when the module comes back, with no rebuild', async () => {
    // Same imported declarations, same bundle: only the presence projection changes,
    // which is all an operator's activation flip changes on the client.
    const off = renderZone({ permissions: BOTH_PERMISSIONS, present: ['price_lists'] });
    await waitFor(() => expect(off.container.textContent).toContain(PRICE_LISTS_PANEL));
    expect(off.container.textContent).not.toContain(QUICK_ORDER_PANEL);
    off.unmount();

    const back = renderZone({ permissions: BOTH_PERMISSIONS, present: BOTH_PRESENT });
    await bothRenderedInWeightOrder(back.container);
    expect(back.loads.get('quick_order')).toBe(1);
  });
});
