import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The integrations card on the delivery-methods list is a **zone** (feature
 * 091, batch 8; FR-007), and this is the proof that it behaves as one.
 *
 * ## The defect this replaces
 *
 * `DeliveryMethodsPage.tsx` used to hold a hard-coded `dhl_parcel` block and a
 * hard-coded `inpost` block, each carrying that module's title, description,
 * route and permission code, each behind its own
 * `useSurfaceVisibility({ module: '…' })`.
 * `backend/scripts/ledgers/foreign-module-ids.ts` recorded both — the shape
 * FR-007 cites by name: a module reaching into another module's screen because
 * the screen offers nowhere to contribute to. Adding a third carrier meant
 * editing a file its author does not own.
 *
 * ## What is asserted, and why the renderer is real
 *
 * `useAdminZone` **throws** outside `AdminContributionsProvider` rather than
 * answering `[]`, deliberately, so "no provider" and "nobody contributed"
 * cannot be confused. A zone asserted against a stub of the enumeration asserts
 * that the stub was consulted, so every case here drives the real provider over
 * the real declarations — imported from the two carrier packages, not written
 * out here, so a contribution whose `requiredPermission` drifts fails on the
 * gate rather than on a copy of it.
 *
 * The three properties that matter are each an `it`: the card renders one entry
 * per **contributing** module; a contributor that is switched off or whose code
 * the operator lacks disappears while the other stays (which a per-module
 * assertion cannot see); and the **host's own card** does not render at all
 * when nothing survives the filter, because an empty bordered panel titled
 * *Integrations* is worse than no panel.
 */

const list = vi.fn(async () => []);
const orderStatuses = vi.fn(async () => []);

vi.mock('../../../../packages/modules/delivery_methods/src/admin/api/delivery-methods-client', () => ({
  deliveryMethodsClient: {
    list: (...args: unknown[]) => list(...(args as [])),
    orderStatuses: (...args: unknown[]) => orderStatuses(...(args as [])),
    upsert: vi.fn(),
    remove: vi.fn(),
  },
}));

const { DeliveryMethodsPage } = await import(
  '../../../../packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage'
);
const dhlParcel = await import('@endora-commerce/mod-dhl-parcel/admin');
const inpost = await import('@endora-commerce/mod-inpost/admin');

/**
 * The registry entries the host's provider is seeded with — the carriers' own
 * declarations, read from their packages.
 *
 * A contribution written out here would be a copy of the thing under test, and
 * the failure this file exists to catch (a contributor whose zone name or whose
 * permission code drifts) is exactly the one a copy hides.
 */
const CARRIER_ENTRIES = [
  { moduleId: 'dhl_parcel', contributions: dhlParcel.contributions },
  { moduleId: 'inpost', contributions: inpost.contributions },
];

const bundle = {
  ...passthroughBundle('core', [
    'legacyMethods.delivery.title',
    'legacyMethods.delivery.description',
    'legacyMethods.delivery.empty',
    'legacyMethods.delivery.noPermission',
    'legacyMethods.integrations.title',
    'legacyMethods.integrations.shippingDescription',
    'legacyMethods.formTitle',
    'legacyMethods.columns.code',
    'legacyMethods.columns.name',
    'legacyMethods.columns.cost',
    'legacyMethods.columns.status',
    'legacyMethods.fields.code',
    'legacyMethods.fields.nameEn',
    'legacyMethods.fields.namePl',
    'legacyMethods.fields.cost',
    'legacyMethods.fields.currency',
    'legacyMethods.fields.status',
    'legacyMethods.status.active',
    'legacyMethods.status.inactive',
    'common.state.loading',
    'common.action.save',
    'common.action.edit',
    'common.action.delete',
  ]),
  ...passthroughBundle('dhl_parcel', [
    'integrations.deliveryMethods.name',
    'integrations.deliveryMethods.description',
    'integrations.deliveryMethods.configure',
  ]),
  ...passthroughBundle('inpost', [
    'integrations.deliveryMethods.name',
    'integrations.deliveryMethods.description',
    'integrations.deliveryMethods.configure',
  ]),
};

function renderPage(options: {
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/delivery-methods']}>
        <DeliveryMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: CARRIER_ENTRIES,
      },
    ),
    bundle,
  );
}

/** The configuration links the integrations card rendered, in DOM order. */
function integrationHrefs(): (string | null)[] {
  return [...document.querySelectorAll('a')]
    .map((a) => a.getAttribute('href'))
    .filter((href) => href === '/delivery-methods/dhl-parcel' || href === '/settings/inpost');
}

const cardIsRendered = (): boolean =>
  screen.queryAllByText('legacyMethods.integrations.title').length > 0;

describe('the delivery-methods integrations card is a zone', () => {
  it('renders one entry per contributing module, in declared weight order', async () => {
    // The positive control. Both carriers present, both codes held: two cards,
    // `dhl_parcel` first because it declares the lower weight — which is the
    // order the hand-written block had.
    renderPage({
      permissions: ['delivery_methods:read', 'dhl_parcel:read', 'inpost:manage'],
      present: ['delivery_methods', 'dhl_parcel', 'inpost'],
    });
    await waitFor(() => expect(cardIsRendered()).toBe(true));
    await waitFor(() =>
      expect(integrationHrefs()).toEqual(['/delivery-methods/dhl-parcel', '/settings/inpost']),
    );
  });

  it('drops one contributor and keeps the other when a carrier is switched off', async () => {
    // The case a per-module off-state file cannot see, and the reason this one
    // exists: a gate keyed on something other than the contributor's own module
    // would take both cards away or neither, and would look exactly like a
    // correct platform in two separate files that switched both carriers off
    // together.
    renderPage({
      permissions: ['delivery_methods:read', 'dhl_parcel:read', 'inpost:manage'],
      present: ['delivery_methods', 'inpost'],
    });
    await waitFor(() => expect(cardIsRendered()).toBe(true));
    await waitFor(() => expect(integrationHrefs()).toEqual(['/settings/inpost']));
  });

  it('drops one contributor and keeps the other on the permission axis', async () => {
    // The second axis, moved on its own. `inpost:manage` is withheld while
    // `dhl_parcel:read` is held and both modules are present, so a contribution
    // whose `requiredPermission` the renderer ignored would still be here.
    renderPage({
      permissions: ['delivery_methods:read', 'dhl_parcel:read'],
      present: ['delivery_methods', 'dhl_parcel', 'inpost'],
    });
    await waitFor(() => expect(cardIsRendered()).toBe(true));
    await waitFor(() =>
      expect(integrationHrefs()).toEqual(['/delivery-methods/dhl-parcel']),
    );
  });

  it('renders no card at all when nothing survives the filter', async () => {
    // The host's half. `useAdminZone` has already applied both axes and every
    // contribution's own permission, so its length is the honest answer to
    // "does this operator have any integration to see" — and an empty bordered
    // panel titled *Integrations* is worse than no panel.
    renderPage({
      permissions: ['delivery_methods:read'],
      present: ['delivery_methods'],
    });
    // The screen itself must have rendered, or the absence below proves
    // nothing: a subject that never mounted looks exactly like a pass.
    await waitFor(() =>
      expect(screen.queryAllByText('legacyMethods.delivery.title').length).toBeGreaterThan(0),
    );
    expect(cardIsRendered()).toBe(false);
    expect(integrationHrefs()).toEqual([]);
  });

  it('names no carrier module in the host screen’s own source', async () => {
    // The evidence that the conversion converted something. The two
    // `foreign-module-ids` entries retire on this: the host used to spell
    // `dhl_parcel` and `inpost` as string literals in a visibility gate, and
    // `check:admin-zones` is what refuses a new one.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(
        process.cwd(),
        '../packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage.tsx',
      ),
      'utf8',
    );
    expect(source).not.toContain("module: 'dhl_parcel'");
    expect(source).not.toContain("module: 'inpost'");
    expect(source).toContain("useAdminZone('delivery_method.list.integrations'");
  });

  it('declares the zone once per carrier, against the published enum member', async () => {
    // Both ends of `AdminZonePropsMap` are checked by `tsc`; what is checked
    // here is the datum in between, because `check:admin-zones` reads the
    // declaration as text and this reads the value the admin composes.
    //
    // **Once per carrier, not "the only zone the carrier declares"**, and this
    // assertion read the second until P7d gave both carriers contributions on
    // the order screen. The subject here is *this* member: a carrier
    // contributing to it twice would render two cards for one integration,
    // which is what the filter and the count below refuse. What the carrier
    // does elsewhere is its own test's.
    for (const entry of CARRIER_ENTRIES) {
      const zones = (entry.contributions.zones ?? []).filter(
        (zone) => zone.zone === 'delivery_method.list.integrations',
      );
      expect(zones, entry.moduleId).toHaveLength(1);
      // FR-013: the chunk is behind a factory the renderer reaches only after
      // it has decided presence and permission.
      expect(typeof zones[0]!.component).toBe('function');
      const loaded = await zones[0]!.component();
      expect(typeof loaded.default).toBe('function');
    }
  });
});
