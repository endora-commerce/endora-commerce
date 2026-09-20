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
 * cannot be confused. A zone asserted against a stub of the *enumeration* asserts
 * that the stub was consulted, so every case here drives the real provider, the
 * real screen and the real renderer.
 *
 * **Both contributors are test-local literals since feature 134's wave 1, and the
 * subject of every case is the host.** The two carrier packages left this
 * repository — `inpost` under T035 and `dhl_parcel` under T036 — so their
 * declarations are not here to import. What `DeliveryMethodsPage`, a **free**
 * module's screen, needs from a contributor is a zone name, a weight and a
 * permission code, and a literal supplies all three; what a literal cannot
 * honestly assert is a *carrier's own* declaration, so the case that did that is
 * gone rather than re-pointed. See `CARRIER_ENTRIES` below.
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

/** What each stand-in contribution renders: the configuration link, and nothing else. */
function DhlParcelCardStandIn(): React.JSX.Element {
  return <a href="/delivery-methods/dhl-parcel">integrations.deliveryMethods.configure</a>;
}

function InpostCardStandIn(): React.JSX.Element {
  return <a href="/settings/inpost">integrations.deliveryMethods.configure</a>;
}

/**
 * The registry entries the host's provider is seeded with — **two literals, which is
 * ruling α carried to its end** (`specs/134-paid-module-extraction/` T032, applied by
 * T035 for `inpost` and by T036 for `dhl_parcel`).
 *
 * The doc block above says a contribution written out here is a copy of the thing
 * under test. That is true, and it is why T035 kept `dhl_parcel`'s real declaration
 * while it was still here — and why the one case that read it is deleted rather than
 * re-pointed now that it is not. The choice for the rest of the file is a literal or
 * nothing, and nothing would delete the **host's** half, which is what this file is
 * actually about: the subject of every case below is `DeliveryMethodsPage`, a **free**
 * module's screen, and what it needs from a contributor is a zone name, a weight and a
 * permission code.
 *
 * The alternative was refused twice, for the same reason both times: the FR-021
 * carrier fixture **cannot** be a subject here, because an overlay module cannot
 * contribute an admin zone at all — `generate-composer.ts` emits
 * `admin/src/modules.generated.ts` from module **packages** only and overlays are
 * discovered at runtime (**D-104**).
 *
 * Each literal is a transcript of that package's own `./admin` declaration as it stood
 * when the package left. `dhl_parcel`: weight 100, `dhl_parcel:read`, one lazily-loaded
 * card linking `/delivery-methods/dhl-parcel`
 * (`packages/modules/dhl_parcel/src/admin/index.ts`, at
 * `d699322fc9b98ca4dc3fa0edbf27b0e87718f81b`). `inpost`: weight 200, `inpost:manage`,
 * one lazily-loaded card. **The weights are load-bearing here and only here** — the
 * first case asserts the DOM order they produce — so a transcript that got them the
 * wrong way round would pass a test about the ordering of a list it had reordered.
 * Each carrier's own *"declares this zone once"* assertion is asked in the paid
 * repository instead.
 */
const CARRIER_ENTRIES = [
  {
    moduleId: 'dhl_parcel',
    contributions: {
      zones: [
        {
          zone: 'delivery_method.list.integrations' as const,
          component: async () => ({ default: DhlParcelCardStandIn }),
          weight: 100,
          requiredPermission: 'dhl_parcel:read',
        },
      ],
    } satisfies AdminContributions,
  },
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

  // **The case that asserted *"declares the zone once per carrier, against the
  // published enum member"* is gone, and its absence is the rule rather than a gap**
  // (`specs/134-paid-module-extraction/` T036; T035 removed `inpost` from its loop for
  // the same reason). It asserted a **carrier's own declaration**, and with both
  // carriers now test-local literals it would assert that a literal in this file says
  // what this file put in it — green, and evidence of nothing. It is asked in the paid
  // repository, over each package's real `./admin` layer, which is where the
  // declaration now is. Nothing in *this* repository lost a subject it could still
  // measure.
});
