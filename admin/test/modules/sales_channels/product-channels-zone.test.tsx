import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `sales_channels` contributes the product editor's Channels tab body (feature
 * 091, P7a; FR-007).
 *
 * ## The defect this replaces
 *
 * `catalog`'s `ProductEditor.tsx` imported `EntityChannelMembership` out of
 * `admin/src/modules/sales_channels/components/` and mounted it as the whole
 * body of a tab whose button it also showed unconditionally — the third admin
 * key in `backend/scripts/ledgers/cross-module-imports/catalog.ts`. The host
 * keeps the tab and its label (its own vocabulary, Z14) and renders the body as
 * `product.editor.channels`; whether the button appears is
 * `useAdminZone(...).length` (Z15), so `catalog` no longer knows which module
 * fills it.
 *
 * ## Three cases, not four
 *
 * `sales_channels` declares `activation.nonDeactivatable`, so it has no off
 * state to drive (`plan.md` Ruling 2). The lock is read from the manifest; the
 * permission axis takes the other three.
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

const salesChannels = await import('@endora-commerce/mod-sales-channels/admin');
const { manifest } = await import('@endora-commerce/mod-sales-channels');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111101';

const REGISTRY = [{ moduleId: 'sales_channels', contributions: salesChannels.contributions }];

const BUNDLE = passthroughBundle('sales_channels', [
  'membership.title',
  'membership.loading',
  'membership.empty',
  'membership.error.load',
  'membership.action.add',
  'membership.action.remove',
  'membership.action.pickChannel',
  'membership.defaultSuffix',
  'badge.systemDefault',
  'status.inactive',
]);

function renderZone(options: { readonly permissions?: readonly string[] }): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/catalog/products/x']}>
        <AdminZone name="product.editor.channels" props={{ productId: PRODUCT_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({
          permissions: [...(options.permissions ?? ['sales_channels:read'])],
        }),
        presence: modulePresence({ present: ['sales_channels'] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('sales_channels contributes the product editor channels zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/by-entity/')) {
        return { entityType: 'product', entityId: PRODUCT_ID, channels: [] };
      }
      if (url.includes('/sales-channels')) return { items: [], page: 1, pageSize: 20, total: 0 };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares one member, with no match and the read code its routes enforce', () => {
    // One host, one mount: `match` narrows the mounts of one place (Z13) and
    // has nothing to narrow here. Asserted absent so a later author cannot add
    // one quietly.
    const zones = salesChannels.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual(['product.editor.channels']);
    expect(zones[0]!.match).toBeUndefined();
    expect(zones[0]!.requiredPermission).toBe('sales_channels:read');
    expect(typeof zones[0]!.component).toBe('function');
  });

  it('renders the membership panel for the product it is mounted on', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('membership.title'));
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/sales-channels/by-entity/product/${PRODUCT_ID}`,
    );
  });

  it('renders nothing without sales_channels:read, and fetches no chunk', async () => {
    const container = renderZone({ permissions: ['catalog:write'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores the zone when the permission comes back', async () => {
    const container = renderZone({ permissions: ['sales_channels:read'] });
    await waitFor(() => expect(container.textContent).toContain('membership.title'));
  });

  it('has no off state to drive, and says so from its own manifest', () => {
    expect(manifest.activation).toEqual(expect.objectContaining({ nonDeactivatable: true }));
  });
});
