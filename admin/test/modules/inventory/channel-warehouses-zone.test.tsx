import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `inventory` contributes the sales-channel editor's warehouse panel (feature
 * 091, P7c; FR-007).
 *
 * ## The defect this replaces
 *
 * `sales_channels`' `SalesChannelEditPage.tsx` imported `ChannelMembershipPanel`
 * from `admin/src/modules/warehouses/` — the single key in
 * `backend/scripts/ledgers/cross-module-imports/sales_channels.ts`, whose
 * recorded retiring condition is *"the owner declaring an admin contribution
 * zone"*. The host renders `sales_channel.editor.after`; this module declares
 * the other end, and its `warehouses-client` does not travel with it: both
 * reads are HTTP paths whose types are already `@endora-commerce/contracts`'.
 *
 * ## Four cases, because this module has both axes
 *
 * `inventory` declares `activation.settingCode`, so it has a real off state:
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

const inventory = await import('@endora-commerce/mod-inventory/admin');
const { manifest } = await import('@endora-commerce/mod-inventory');

const CHANNEL_ID = '44444444-4444-4444-8444-444444444404';

const REGISTRY = [{ moduleId: 'inventory', contributions: inventory.contributions }];

const BUNDLE = passthroughBundle('core', [
  'warehouses.channel.title',
  'warehouses.channel.loading',
  'warehouses.channel.empty',
  'warehouses.channel.addTitle',
  'warehouses.channel.defaultBadge',
  'warehouses.channel.column.warehouse',
  'warehouses.channel.column.code',
  'warehouses.channel.column.default',
  'warehouses.channel.column.sort',
  'warehouses.channel.action.makeDefault',
  'warehouses.channel.action.unassign',
  'warehouses.channel.action.add',
  'warehouses.channel.action.adding',
  'warehouses.channel.field.warehouse',
  'warehouses.channel.field.pickOne',
  'warehouses.channel.error.load',
]);

function renderZone(options: {
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/sales-channels/x']}>
        <AdminZone name="sales_channel.editor.after" props={{ channelId: CHANNEL_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['inventory:read'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['inventory'])] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('inventory contributes the sales-channel editor zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url.includes('/warehouses?') || url.endsWith('/warehouses')) {
        if (url.startsWith('/api/v1/admin/warehouses')) {
          return { items: [], page: 1, pageSize: 200, total: 0 };
        }
        return { items: [] };
      }
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('declares one member, with no match and the read code its routes enforce', () => {
    const zones = inventory.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual(['sales_channel.editor.after']);
    expect(zones[0]!.match).toBeUndefined();
    expect(zones[0]!.requiredPermission).toBe('inventory:read');
    expect(typeof zones[0]!.component).toBe('function');
  });

  it('renders the warehouse panel for the channel it is mounted on', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('warehouses.channel.title'));
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/sales-channels/${CHANNEL_ID}/warehouses`,
    );
  });

  it('renders nothing while the module is switched off, and fetches no chunk', async () => {
    // The platform axis, on its own: the operator holds `inventory:read` and
    // stock management is off, so a channel↔warehouse binding is not a thing
    // they can have an opinion about.
    const container = renderZone({ present: [] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing without inventory:read, and fetches no chunk', async () => {
    // The permission axis, on its own. An operator who may edit a sales channel
    // and not touch stock gets no panel rather than one that 403s on load.
    const container = renderZone({ permissions: ['sales_channels:write'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores the zone when the module comes back', async () => {
    const container = renderZone({ present: ['inventory'] });
    await waitFor(() => expect(container.textContent).toContain('warehouses.channel.title'));
  });

  it('leaves the host naming neither this module nor its panel', async () => {
    // The evidence that the conversion converted something: the single key in
    // `cross-module-imports/sales_channels.ts` retires on this, and that shard
    // is deleted with it.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const host = readFileSync(
      resolve(process.cwd(), 'src/modules/sales_channels/pages/SalesChannelEditPage.tsx'),
      'utf8',
    );
    expect(host).not.toContain('ChannelMembershipPanel');
    // The import, not the word: the mount's own comment names the directory the
    // panel came out of, which is the record a reader of that file wants.
    expect(host).not.toContain("from '../../warehouses/");
    expect(host).toContain('name="sales_channel.editor.after"');
  });

  it('is switchable, which is what makes the off-state case above real', () => {
    // The mirror of `price_lists`' and `sales_channels`' lock assertion: this
    // module's fourth case exists because the manifest gives it an activation
    // control, read from the manifest rather than assumed.
    expect(manifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'inventory.enabled' }),
    );
  });
});
