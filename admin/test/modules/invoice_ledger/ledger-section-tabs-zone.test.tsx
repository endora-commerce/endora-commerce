import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminZoneContribution } from '@endora-commerce/contracts';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { RouteTabLink } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The invoice-ledger section strip (`ledger.section.tabs`), from the side of
 * the **free module that owns the place** — feature 134 **W2.2**
 * (**D-262** clause 3).
 *
 * ## What this file used to be, and why the change is not an ordinary W2
 *
 * It resolved the paid `infakt` package's `./admin` subpath beside
 * `@endora-commerce/mod-invoice-ledger/admin` and drove the strip over both.
 * That made it the one admin file refusing `infakt`'s extraction — and it is a
 * **free** module's test, not the departing module's, so neither of W2.2's two
 * travelling dispositions applies to it as a whole: *moving it into the
 * package* would move a free module's coverage into a paid package, and
 * *deleting it* would throw the free module's own zone proof away.
 *
 * Its four subjects went to four homes, and only the last one was ever this
 * file's:
 *
 * | subject | where it is now |
 * | --- | --- |
 * | **`invoice_ledger`'s declaration** — two tabs on this zone, no `match`, `invoice_ledger:read`, deliveries before routing, one Sales row | `packages/modules/invoice_ledger/src/admin/index.test.ts`, under that package's existing `environment: 'node'` config |
 * | **`infakt`'s declaration** — one tab on this zone, no `match`, `infakt:read`, a weight above the host's own, no Sales row | that package's own `src/admin/index.test.ts`, the same shape, and it travels with the module |
 * | each package's own **source hygiene** — every page the strip switches between mounts the strip | the same two package tests, the `readFileSync` becoming a read relative to the package's own sources |
 * | the **zone mechanism** — ordering, presence, permission, selected state, and "a strip of one is not a choice" | **here**, below, because the place is `invoice_ledger`'s and `invoice_ledger` is staying |
 *
 * ## The vendor tab is synthetic now, and that is the answer rather than a
 * concession
 *
 * The rendered cases are **re-pointed, not deleted**: every one of them still
 * runs, over `invoice_ledger`'s **real** two declarations plus a synthetic
 * third contributor mounted here. That is
 * `admin/test/modules/orders/OrderShipmentsTab.carrier-zones.test.tsx`'
 * established pattern — a host's zone test supplies its own contribution,
 * because a real one asserts the contributor's declaration a second time in the
 * file whose subject is the host.
 *
 * It is synthetic rather than a free module's real declaration because **no
 * free module contributes to this zone and none can today**. Its declared
 * contributors are `invoice_ledger` itself and the vendor adapters of the
 * `invoice-ledger-vendor` family, every one of which wave 4 removes — one has
 * left already and this file is the last rung of the other's extraction, so
 * after it the only real contributions to this place are the host's own two.
 * `ledger_vendor_fixture`, the example deployment's stand-in vendor, is an
 * **overlay** module — and an overlay contributes to no committed artefact
 * (D-104, `packages/cli/src/lib/admin-artefacts.ts`), so it cannot appear in
 * `admin/src/modules.generated.ts` and cannot be a real admin contributor
 * here. Giving it an admin surface would not produce one either, until that
 * rule changes.
 *
 * So what a vendor is, to this file, is now a **shape**: a contribution to
 * `ledger.section.tabs` with a weight above the host's own and its own read
 * code. That makes this file a surviving driver for **every** ledger vendor's
 * departure rather than a file repaired once per vendor — which is what it
 * would otherwise have been, since the next vendor to arrive would have to be
 * added to it and the next to leave taken out again.
 *
 * **What is genuinely lost** is the conjunction over a vendor's *real*
 * declaration — that `infakt`'s own tab, with its own weight and its own code,
 * appears in this strip. The declaration itself keeps a test and gains a run
 * (it is now asserted in `infakt`'s own suite as well), and the mechanism keeps
 * a real subject here; what no single file states any more is the agreement
 * between the two. **No file is deleted here**, so the recovery address is this
 * path's own history and needs no pinned sha to survive a rebase:
 * `git log --follow -p -- admin/test/modules/invoice_ledger/ledger-section-tabs-zone.test.tsx`
 * holds the pre-split text, including the four cases as they read over the
 * vendor's real declaration.
 *
 * `check:off-state-coverage`'s counter measures none of this — its walk root is
 * `backend/test` alone — so a green `switchable=N proven=N findings=0` beside
 * this change is not a claim about the admin half.
 */

const ledger = await import('@endora-commerce/mod-invoice-ledger/admin');

const DELIVERIES = 'tabs.deliveries';
const ROUTING = 'tabs.routing';

/** The strip's own two labels; the synthetic tab carries a literal. */
const BUNDLE = passthroughBundle('invoice_ledger', [DELIVERIES, ROUTING]);

/**
 * A stand-in ledger vendor, in the shape the zone's contract asks a vendor for:
 * one tab, its own read code, and a weight above the two the host occupies
 * (100 and 200), so that the vendor's connection tab sorts after the host's
 * own. `RouteTabLink` rather than a bare anchor, because selected state is the
 * contributed tab's responsibility and a probe that did not use it would let
 * the third case below pass over a tab no vendor could write.
 */
const VENDOR_MODULE = 'ledger_vendor';
const VENDOR_PERMISSION = 'ledger_vendor:read';
const VENDOR_ROUTE = '/ledger-vendor';
const VENDOR_LABEL = 'Vendor connection';

const vendorTab: AdminZoneContribution = {
  zone: 'ledger.section.tabs',
  weight: 300,
  requiredPermission: VENDOR_PERMISSION,
  component: async () => ({
    default: function VendorLedgerTab(): ReactNode {
      return <RouteTabLink to={VENDOR_ROUTE} label={VENDOR_LABEL} />;
    },
  }),
};

const REGISTRY = [
  { moduleId: 'invoice_ledger', contributions: ledger.contributions },
  { moduleId: VENDOR_MODULE, contributions: { zones: [vendorTab] } },
];

function renderStrip(options: {
  readonly path?: string;
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[options.path ?? '/invoice-ledger/deliveries']}>
        <RouteTabsZone name="ledger.section.tabs" props={{}} />
      </MemoryRouter>,
      {
        session: adminSession({
          permissions: [...(options.permissions ?? ['invoice_ledger:read', VENDOR_PERMISSION])],
        }),
        presence: modulePresence({
          present: [...(options.present ?? ['invoice_ledger', VENDOR_MODULE])],
        }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('ledger.section.tabs — the strip', () => {
  it('offers the host’s two routes and a vendor’s third, in weight order', async () => {
    const container = renderStrip({});
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(3));
    const hrefs = [...container.querySelector('[role="tablist"]')!.querySelectorAll('a')].map(
      (anchor) => anchor.getAttribute('href'),
    );
    // The vendor's tab sorts last because its weight is above the host's own
    // two, which is the whole of what the host asks a vendor for.
    expect(hrefs).toEqual(['/invoice-ledger/deliveries', '/invoice-ledger/routing', VENDOR_ROUTE]);
  });

  it('keeps the host’s own two, and the strip, while the vendor is switched off', async () => {
    const container = renderStrip({ present: ['invoice_ledger'] });
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
    expect(screen.queryByRole('tab', { name: VENDOR_LABEL })).toBeNull();
    // Exactly `MINIMUM_TABS`: the host's own two are what keep the strip up
    // when no vendor is installed, which is why the routing screen is a tab
    // rather than a second Sales row.
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('marks the routing tab on the routing route', async () => {
    renderStrip({ path: '/invoice-ledger/routing' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    expect(screen.getByRole('tab', { name: ROUTING }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: DELIVERIES }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('hides the vendor tab from an operator without the vendor’s code', async () => {
    const container = renderStrip({ permissions: ['invoice_ledger:read'] });
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
    expect(screen.queryByRole('tab', { name: VENDOR_LABEL })).toBeNull();
  });

  it('renders no strip at all when only one tab would survive', async () => {
    // `RouteTabsZone`'s `MINIMUM_TABS`, driven over a real declaration: an
    // operator holding only the vendor's code sees one tab, and one tab is not
    // a choice. The assertion the old file's header claimed and never made.
    //
    // The absence is asserted **synchronously**: the strip counts
    // `useAdminZone`'s result before any chunk is requested, so an awaited
    // `toBeNull` would pass on the first frame whatever happened afterwards.
    // The control render below is what stops that from being vacuous — same
    // registry, same presence, one more code.
    const vendorOnly = renderStrip({ permissions: [VENDOR_PERMISSION] });
    expect(vendorOnly.querySelector('[role="tablist"]')).toBeNull();
    expect(vendorOnly.querySelectorAll('a')).toHaveLength(0);

    const control = renderStrip({ permissions: [VENDOR_PERMISSION, 'invoice_ledger:read'] });
    await waitFor(() => expect(control.querySelectorAll('a')).toHaveLength(3));
  });
});
