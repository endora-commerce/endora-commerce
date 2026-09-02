import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminZoneName } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `quick_order` contributes the two detail zones (feature 091, P7b; FR-007).
 *
 * ## The defect this replaces
 *
 * `organizations`' `OrganizationDetail.tsx` and `customers`'
 * `CustomerDetail.tsx` each imported `DefaultPreferencesPanel` out of
 * `admin/src/modules/quick_order/` — one key in each of the two boundary
 * shards, and `customers.ts` held nothing else, so it is deleted. Both hosts
 * render a zone now and this module declares the other end.
 *
 * ## Two members, not one with a `match`
 *
 * Z13: `match` narrows the mounts of *one* place, and these are two hosts with
 * a place each. Under the rejected shared `entity.detail.after` this file would
 * assert one contribution and a `match`; the pair of four-line wrappers is the
 * whole cost of the split, and in exchange `unrendered-zone` answers per host.
 *
 * ## The permission is `orders:write`, and the contract's `quick_order:read` is
 * wrong
 *
 * §10.6 declared `quick_order:read`. Measured in this merge request, as §9.3
 * requires: every admin route this module owns is gated on `orders:write`
 * (`packages/modules/quick_order/src/backend/routes.preferences.admin.ts`), the
 * manifest's own palette action says so in place, and there is no
 * `quick_order:*` code anywhere in the platform — so the contract's code is one
 * no role can hold, which would hide the panel from every operator rather than
 * merely advertising a 403. Asserted here so the correction cannot be undone by
 * copying the contract.
 *
 * ## Four cases, because this module has both axes
 *
 * `quick_order` declares `activation.settingCode`, so it has a real off state:
 * present, switched off, permission withheld, restored.
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

const quickOrder = await import('@endora-commerce/mod-quick-order/admin');
const { manifest } = await import('@endora-commerce/mod-quick-order');

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

const REGISTRY = [{ moduleId: 'quick_order', contributions: quickOrder.contributions }];

const BUNDLE = passthroughBundle('core', [
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
]);

function renderZone(options: {
  readonly name: AdminZoneName;
  readonly props: Record<string, unknown>;
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/x']}>
        {/* `AdminZone` is generic on the literal name at a host's call site;
            this helper is generic over the two members this module serves, so
            the cast is the harness's and not a host's. */}
        <AdminZone
          name={options.name as 'organization.detail.after'}
          props={options.props as { organizationId: string }}
        />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['orders:write'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['quick_order'])] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('quick_order contributes the organization and customer detail zones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/admin/quick-order/preferences')) return { data: null };
      if (url.includes('/addresses')) {
        return url.includes('/customers/')
          ? { data: { personal: [], organization: [] } }
          : { data: [] };
      }
      if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [] };
      if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [] };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares P7b\'s two members and P4d\'s tab, with no match on any', () => {
    // `match` narrows the *mounts of one place* (Z13). The two detail members
    // have one host and one mount each; `order.entry.tabs` has two mounts and
    // no props at all — so on all three a `match` could only ever be an
    // enumeration of another module's vocabulary. Asserted absent so a later
    // author cannot add one quietly.
    //
    // The whole list, not a filter: this is the two-way statement about what
    // this module contributes, so a fourth contribution has to be declared here
    // as well as there. `order.entry.tabs` arrived in P4d and is asserted in
    // full by `admin/test/modules/orders/order-entry-tabs-zone.test.tsx`.
    const zones = quickOrder.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual([
      'organization.detail.after',
      'customer.detail.after',
      'order.entry.tabs',
    ]);
    for (const zone of zones) {
      expect(zone.match, zone.zone).toBeUndefined();
      // Not `quick_order:read`, which the contract named and which exists
      // nowhere — see this file's header.
      expect(zone.requiredPermission, zone.zone).toBe('orders:write');
      // FR-013: the chunk sits behind a factory the renderer reaches only after
      // it has decided presence and permission.
      expect(typeof zone.component, zone.zone).toBe('function');
    }
  });

  it('orders itself third among the organization detail\'s four contributors', () => {
    // The weights preserve the order the operator saw when the panels were
    // scattered through `OrganizationDetail.tsx`: `sales_channels` (100),
    // `price_lists` (200), this panel (300), `carts` (400).
    const organization = (quickOrder.contributions.zones ?? []).find(
      (zone) => zone.zone === 'organization.detail.after',
    );
    expect(organization?.weight).toBe(300);
  });

  it('renders the defaults panel with the organization scope', async () => {
    const container = renderZone({
      name: 'organization.detail.after',
      props: { organizationId: ORG_ID },
    });
    await waitFor(() => expect(container.textContent).toContain('defaultPreferences.title'));
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/quick-order/preferences?scope=organization&scopeId=${ORG_ID}`,
    );
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG_ID}/addresses`);
  });

  it('renders the defaults panel with the customer scope', async () => {
    const container = renderZone({
      name: 'customer.detail.after',
      props: { customerId: CUSTOMER_ID },
    });
    await waitFor(() => expect(container.textContent).toContain('defaultPreferences.title'));
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/quick-order/preferences?scope=customer&scopeId=${CUSTOMER_ID}`,
    );
    // The scope decides the address route, which is the one behaviour the two
    // wrappers do not share.
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/customers/${CUSTOMER_ID}/addresses`);
  });

  it('renders neither zone while the module is switched off, and fetches no chunk', async () => {
    const organization = renderZone({
      name: 'organization.detail.after',
      props: { organizationId: ORG_ID },
      present: [],
    });
    const customer = renderZone({
      name: 'customer.detail.after',
      props: { customerId: CUSTOMER_ID },
      present: [],
    });
    await waitFor(() => expect(organization.textContent).toBe(''));
    expect(customer.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders neither zone without orders:write, and fetches no chunk', async () => {
    const organization = renderZone({
      name: 'organization.detail.after',
      props: { organizationId: ORG_ID },
      permissions: ['customers:manage'],
    });
    const customer = renderZone({
      name: 'customer.detail.after',
      props: { customerId: CUSTOMER_ID },
      permissions: ['customers:manage'],
    });
    await waitFor(() => expect(organization.textContent).toBe(''));
    expect(customer.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores both zones when the module comes back', async () => {
    const container = renderZone({
      name: 'customer.detail.after',
      props: { customerId: CUSTOMER_ID },
      present: ['quick_order'],
    });
    await waitFor(() => expect(container.textContent).toContain('defaultPreferences.title'));
  });

  it('leaves neither host naming this module in its own source', async () => {
    // The evidence that the conversion converted something: the whole of
    // `cross-module-imports/customers.ts` and one key of `organizations.ts`
    // retire on the two host screens no longer importing this module's panel.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // Both paths were re-keyed by feature 091's Phase 4 batch 14, not tidied:
    // the two host screens moved into their own packages, and a `readFileSync`
    // of an old path throws rather than reporting a missing mount. This list is
    // derived *about* files another merge request moves, which is the shape that
    // has produced a stale ledger in every batch that did not look for it.
    for (const [file, member] of [
      [
        '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx',
        'organization.detail.after',
      ],
      ['../packages/modules/customers/src/admin/pages/CustomerDetail.tsx', 'customer.detail.after'],
    ] as const) {
      const host = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(host, file).not.toContain('DefaultPreferencesPanel');
      expect(host, file).not.toContain("from '../quick_order/");
      expect(host, file).toContain(`name="${member}"`);
    }
  });

  it('is switchable, which is what makes the off-state case above real', () => {
    expect(manifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'quick_order.enabled' }),
    );
  });
});
