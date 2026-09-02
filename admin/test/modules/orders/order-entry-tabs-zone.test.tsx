import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The order-entry switch is a zone with two contributed tabs (feature 091, P4d;
 * `contracts/admin-component-contribution.md` §6 P4d).
 *
 * ## The defect this replaces
 *
 * `admin/src/components/OrderEntryTabs.tsx` was a host component that knew both
 * modules: it built a two-element array naming `orders` and `quick_order`, each
 * with the other module's route and the other module's label out of the `core`
 * bundle, filtered it by `useModulePresence` and rendered `RouteTabs`. It sat
 * in `admin/src/components/` because it belonged to neither module, and it was
 * the last two keys of `backend/scripts/ledgers/admin-surface.ts` — the two
 * screens that imported it. This file is the other end of the conversion, and
 * the ledger is empty with it.
 *
 * ## Two hosts, one place — decided, not assumed
 *
 * Z13 refuses a member shared by hosts that each have a place of their own,
 * because one host's mount then covers the other's absence. This member is the
 * exception the rule leaves open and the enum records: the place is one
 * navigational switch that must appear on **both** of the pages it switches
 * between, or it is not a switch. `unrendered-zone` cannot see one of the two
 * mounts go, so the last case in this file asserts both by name.
 *
 * ## `match` is `undefined`, and that is a decision
 *
 * `match` narrows the *mounts of one place* (Z13). Both mounts of this place
 * carry the same props — none at all — so there is nothing to narrow and
 * nothing a `match` could name. Asserted absent so a later author cannot add
 * one quietly: a `match` naming a prop the zone does not carry hides the
 * contribution rather than widening it.
 *
 * ## The permission is `orders:write`, read off the routes in this merge request
 *
 * §9.3, and P7b's correction applied before it can be repeated. Both entry
 * screens post to routes gated on `orders:write` —
 * `packages/modules/orders/src/backend/routes.ts`'s `POST /api/v1/admin/orders`
 * and `packages/modules/quick_order/src/backend/routes.admin.ts`'s two `POST`s
 * — and there is no `quick_order:*` code anywhere in the platform. The strip is
 * therefore all-or-nothing on one code, which is honest: an operator who cannot
 * create an order has no use for a switch between two ways of creating one.
 * The host component gated on presence alone, so this is a gate the conversion
 * **adds**; it is stated here rather than left to be found.
 */

const orders = await import('@endora-commerce/mod-orders/admin');
const quickOrder = await import('@endora-commerce/mod-quick-order/admin');

const STANDARD = 'orderEntry.tab.standard';
const QUICK = 'orderEntry.tab.quick';

/**
 * Each label resolves out of its **own** module's namespace, which is the half
 * of this conversion a rendered assertion can see: the two keys used to be
 * `core`'s, handed to the strip by a host that owned neither tab.
 */
const BUNDLE = {
  ...passthroughBundle('orders', [STANDARD]),
  ...passthroughBundle('quick_order', [QUICK]),
};

const REGISTRY = [
  { moduleId: 'orders', contributions: orders.contributions },
  { moduleId: 'quick_order', contributions: quickOrder.contributions },
];

function renderStrip(options: {
  readonly path?: string;
  readonly permissions?: readonly string[];
  readonly present?: readonly string[];
}): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[options.path ?? '/orders/new']}>
        <RouteTabsZone name="order.entry.tabs" props={{}} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['orders:write'])] }),
        presence: modulePresence({
          present: [...(options.present ?? ['orders', 'quick_order'])],
        }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('order.entry.tabs — the two contributions', () => {
  it('declares one tab each, with no match and the code the routes enforce', () => {
    for (const [module, contributions] of [
      ['orders', orders.contributions],
      ['quick_order', quickOrder.contributions],
    ] as const) {
      const tabs = (contributions.zones ?? []).filter(
        (zone) => zone.zone === 'order.entry.tabs',
      );
      expect(tabs, module).toHaveLength(1);
      const tab = tabs[0]!;
      // One place, one mount per host, identical props: nothing to narrow.
      expect(tab.match, module).toBeUndefined();
      expect(tab.requiredPermission, module).toBe('orders:write');
      // FR-013: the chunk sits behind a factory the renderer reaches only after
      // it has decided presence and permission.
      expect(typeof tab.component, module).toBe('function');
    }
  });

  it('orders the standard tab ahead of the quick one', () => {
    const weightOf = (contributions: (typeof orders)['contributions']): number =>
      (contributions.zones ?? []).find((zone) => zone.zone === 'order.entry.tabs')!.weight;
    expect(weightOf(orders.contributions)).toBeLessThan(weightOf(quickOrder.contributions));
  });
});

describe('order.entry.tabs — the strip the two contributions make', () => {
  it('offers both order-entry routes, in weight order', async () => {
    const container = renderStrip({});
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
    const hrefs = [...container.querySelector('[role="tablist"]')!.querySelectorAll('a')].map(
      (anchor) => anchor.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/orders/new', '/orders/quick-order']);
  });

  it('marks the standard tab on the standard route', async () => {
    renderStrip({ path: '/orders/new' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    expect(screen.getByRole('tab', { name: STANDARD }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: QUICK }).getAttribute('aria-selected')).toBe('false');
  });

  it('marks the quick tab on the quick route', async () => {
    renderStrip({ path: '/orders/quick-order' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    expect(screen.getByRole('tab', { name: QUICK }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: STANDARD }).getAttribute('aria-selected')).toBe('false');
  });

  it('renders no strip at all when quick_order is switched off', async () => {
    // The rule the host component used to spell with two module ids: one
    // remaining tab is not a choice, so there is nothing to switch between.
    // `RouteTabsZone` counts what `useAdminZone` already filtered.
    const container = renderStrip({ present: ['orders'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('renders no strip without orders:write', async () => {
    const container = renderStrip({ permissions: ['orders:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('restores the strip when both modules are back', async () => {
    const container = renderStrip({ present: ['orders', 'quick_order'] });
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
  });
});

describe('order.entry.tabs — both hosts mount the place', () => {
  it('renders the member on each entry screen and names the deleted component nowhere', async () => {
    // The member has two mounts and `unrendered-zone` is computed per member,
    // so one host's mount would cover the other's absence. This is the
    // assertion that does not.
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // **Re-keyed by feature 091's Phase 4 batch 13**, which moved the second of
    // the two hosts into `@endora-commerce/mod-quick-order/admin`. This list is
    // a ledger *about* the files it names rather than one of them, so the batch
    // that moves a host is structurally the batch that cannot see the entry go
    // stale — and a `readFileSync` of a path that no longer exists throws
    // rather than reporting a mount that is missing, which is the failure this
    // case exists to make legible.
    for (const file of [
      'src/modules/orders/OrderCreatePage.tsx',
      '../packages/modules/quick_order/src/admin/pages/QuickOrderOnBehalfPage.tsx',
    ]) {
      const host = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(host, file).toContain('name="order.entry.tabs"');
      expect(host, file).not.toContain('OrderEntryTabs');
    }
    expect(existsSync(resolve(process.cwd(), 'src/components/OrderEntryTabs.tsx'))).toBe(false);
  });
});
