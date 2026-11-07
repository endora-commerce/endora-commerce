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

  it('declares this member, with no match and the read code its routes enforce', () => {
    // One host, one mount: `match` narrows the mounts of one place (Z13) and
    // has nothing to narrow here. Asserted absent so a later author cannot add
    // one quietly.
    const zone = (salesChannels.contributions.zones ?? []).find(
      (candidate) => candidate.zone === 'product.editor.channels',
    );
    expect(zone).toBeDefined();
    expect(zone!.match).toBeUndefined();
    expect(zone!.requiredPermission).toBe('sales_channels:read');
    expect(typeof zone!.component).toBe('function');
  });

  it('declares exactly this one member', () => {
    // The set lives here since feature 154 withdrew the organization detail's
    // contribution (P7b's): `organizations` edits an Organization's channels in
    // a panel of its own, and two editors of one assignment on one page would
    // disagree about who may change it. Asserted as an equality so that it
    // cannot quietly come back.
    expect((salesChannels.contributions.zones ?? []).map((zone) => zone.zone)).toEqual([
      'product.editor.channels',
    ]);
  });

  it('leaves no second copy of its components under admin/src', async () => {
    // Held by `organization-channels-zone.test.tsx` until feature 154 deleted
    // it with the contribution: "no second copy of this component exists under
    // `admin/src`" is the claim the duplication P7a opened made worth checking,
    // and it outlives both the duplication and that file.
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const component of ['EntityChannelMembership', 'DefaultChannelBadge']) {
      expect(
        existsSync(
          resolve(
            process.cwd(),
            `../packages/admin-shell/src/modules/sales_channels/components/${component}.tsx`,
          ),
        ),
        component,
      ).toBe(false);
    }
  });

  it('renders the membership panel for the product it is mounted on', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('membership.title'));
    // The title is in the commit that mounts the panel, and the panel starts its
    // read from that commit's effect: wait for it (issue #418).
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(
        `/api/v1/admin/sales-channels/by-entity/product/${PRODUCT_ID}`,
      ),
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
