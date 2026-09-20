import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';
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

/** What the stand-in contribution below renders: the configuration link, and nothing else. */
function InpostCardStandIn(): React.JSX.Element {
  return <a href="/settings/inpost">integrations.deliveryMethods.configure</a>;
}

/**
 * The subset whose declarations are real — the carriers still in this repository.
 *
 * The last case asserts a *carrier's own* declaration and may only read these; a
 * literal asserted against itself is the shape that reads green and means nothing.
 */
const REAL_CARRIER_ENTRIES = [{ moduleId: 'dhl_parcel', contributions: dhlParcel.contributions }];

/**
 * The registry entries the host's provider is seeded with.
 *
 * **`inpost`'s is written out here rather than imported, and that is ruling α**
 * (`specs/134-paid-module-extraction/` T032, applied by T035). The doc block above
 * says a contribution written out here is a copy of the thing under test — true,
 * and it is why `dhl_parcel`'s is still the real one. `inpost` left this repository
 * with wave 1, so its declaration is not here to import: the choice is a literal or
 * nothing, and nothing would delete the *host's* half of this file, which is what
 * the file is actually about. The subject of every case below is
 * `DeliveryMethodsPage` — a **free** module's screen — and what it needs from a
 * contributor is a zone name, a weight and a permission code.
 *
 * The alternative was refused: the FR-021 carrier fixture **cannot** be a subject
 * here, because an overlay module cannot contribute an admin zone at all —
 * `generate-composer.ts` emits `admin/src/modules.generated.ts` from module
 * **packages** only and overlays are discovered at runtime (**D-104**).
 *
 * The literal is a transcript of `@endora-commerce/mod-inpost/admin`'s own
 * declaration as it stood when the package left, at
 * `packages/modules/inpost/src/admin/index.ts`: weight 200, `inpost:manage`, one
 * lazily-loaded card. Its own assertion moved with it — the paid repository is where
 * "does `inpost` declare this zone once" is now asked, which is the same inversion
 * T036 will apply to `dhl_parcel`'s entry when the second carrier goes and this
 * whole constant becomes two literals.
 */
const CARRIER_ENTRIES = [
  ...REAL_CARRIER_ENTRIES,
  {
    moduleId: 'inpost',
    contributions: {
      zones: [
        {
          zone: 'delivery_method.list.integrations' as const,
          component: async () => ({ default: InpostCardStandIn }),
          weight: 200,
          requiredPermission: 'inpost:manage',
        },
      ],
    } satisfies AdminContributions,
  },
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
    //
    // **`inpost` is not in this loop since wave 1, and the omission is the rule
    // rather than a gap** (`specs/134-paid-module-extraction/` T035). This case
    // asserts a **carrier's own declaration**, so it belongs to the carrier: over
    // the test-local literal above it would assert that a literal in this file
    // says what this file put in it. It is asked in the paid repository instead.
    // T036 empties the loop by the same argument, and deletes the case with it.
    for (const entry of REAL_CARRIER_ENTRIES) {
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
