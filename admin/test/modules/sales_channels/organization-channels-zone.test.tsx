import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `sales_channels` contributes the organization detail's channel membership
 * (feature 091, P7b; FR-007).
 *
 * ## The defect this replaces
 *
 * `organizations`' `OrganizationDetail.tsx` imported `EntityChannelMembership`
 * out of `admin/src/modules/sales_channels/components/` — one of the three keys
 * of `backend/scripts/ledgers/cross-module-imports/organizations.ts`, whose
 * shard P7b deletes. P7a converted the *product editor*'s mount of the same
 * component and could not delete the `admin/src` copy, because this screen was
 * still importing it; both copies stood in the tree for the length of that
 * merge request and this one ends that.
 *
 * ## Two contributions over one component, and no `match`
 *
 * Z4 — a contribution declares one zone — and Z13: `product.editor.channels`
 * and `organization.detail.after` are two hosts with a place each, so they are
 * two members and two wrappers, differing only in the `entityType` each passes.
 * Under a shared `entity.detail.after` this would have been one contribution
 * and a `match`, and one host's mount would cover the other host's absence.
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

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

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
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <AdminZone name="organization.detail.after" props={{ organizationId: ORG_ID }} />
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

describe('sales_channels contributes the organization detail zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/by-entity/')) {
        return { entityType: 'organization', entityId: ORG_ID, channels: [] };
      }
      if (url.includes('/sales-channels')) return { items: [], page: 1, pageSize: 20, total: 0 };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares exactly the two members P7a and P7b add, with no match on either', () => {
    // The set lives here, in the file that changed it. `match` narrows the
    // mounts of one place (Z13); each of these members has one host and one
    // mount, so a `match` here could only ever be an enumeration of another
    // module's vocabulary — asserted absent so a later author cannot add one
    // quietly.
    const zones = salesChannels.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual([
      'product.editor.channels',
      'organization.detail.after',
    ]);
    for (const zone of zones) {
      expect(zone.match, zone.zone).toBeUndefined();
      expect(zone.requiredPermission, zone.zone).toBe('sales_channels:read');
      // FR-013: the chunk sits behind a factory the renderer reaches only after
      // it has decided presence and permission.
      expect(typeof zone.component, zone.zone).toBe('function');
    }
  });

  it('orders itself first among the organization detail\'s four contributors', () => {
    // The weights preserve the order the operator saw when the panels were
    // scattered through `OrganizationDetail.tsx`: this panel (100),
    // `price_lists` (200), `quick_order` (300), `carts` (400).
    const organization = (salesChannels.contributions.zones ?? []).find(
      (zone) => zone.zone === 'organization.detail.after',
    );
    expect(organization?.weight).toBe(100);
  });

  it('renders the membership panel with the organization entity type', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('membership.title'));
    // The `entityType` is the wrapper's constant, and it is the whole difference
    // between this contribution and the product editor's.
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/sales-channels/by-entity/organization/${ORG_ID}`,
    );
  });

  it('renders nothing without sales_channels:read, and fetches no chunk', async () => {
    const container = renderZone({ permissions: ['customers:manage'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores the zone when the permission comes back', async () => {
    const container = renderZone({ permissions: ['sales_channels:read'] });
    await waitFor(() => expect(container.textContent).toContain('membership.title'));
  });

  it('leaves the host naming neither this module nor its panel', async () => {
    // The evidence that the conversion converted something, and that the
    // duplication P7a could not end is ended: nothing imports the `admin/src`
    // copy, so the copy is gone.
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // Re-keyed by feature 091's Phase 4 batch 14, not tidied: the host screen
    // moved into its own package, and a `readFileSync` of the old path throws
    // rather than reporting a missing mount.
    const host = readFileSync(
      resolve(
        process.cwd(),
        '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx',
      ),
      'utf8',
    );
    expect(host).not.toContain('EntityChannelMembership');
    expect(host).not.toContain("from '../sales_channels/");
    expect(host).toContain('name="organization.detail.after"');
    expect(
      existsSync(
        resolve(process.cwd(), '../packages/admin-shell/src/modules/sales_channels/components/EntityChannelMembership.tsx'),
      ),
    ).toBe(false);
    // **`DefaultChannelBadge` is gone too, and this assertion is what said when
    // it would be.** It stood here reading `true` with a reason that named its
    // own retiring condition — *"this module's own two screens still import it
    // from `admin/src`, and it retires when they move in batch 14"*. That is
    // this batch: both screens are `@endora-commerce/mod-sales-channels`' now
    // and import the package's copy, so nothing named the `admin/src` one and
    // it was deleted. The assertion is inverted rather than removed, because
    // "no second copy of this component exists under `admin/src`" is the claim
    // the duplication P7a opened made worth checking, and it outlives the
    // duplication.
    expect(
      existsSync(
        resolve(process.cwd(), '../packages/admin-shell/src/modules/sales_channels/components/DefaultChannelBadge.tsx'),
      ),
    ).toBe(false);
  });

  it('has no off state to drive, and says so from its own manifest', () => {
    expect(manifest.activation).toEqual(expect.objectContaining({ nonDeactivatable: true }));
  });
});
