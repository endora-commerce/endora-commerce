import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Invoice-ledger section switch: deliveries, routing, and vendor connection
 * tabs (`ledger.section.tabs`).
 *
 * Deliveries and routing are two contributions from `invoice_ledger`. Infakt
 * adds a third when present. The sidebar keeps one row. `RouteTabsZone`
 * hides a strip with fewer than two visible tabs; the two ledger tabs keep
 * the strip up when Infakt is off.
 */

const ledger = await import('@endora-commerce/mod-invoice-ledger/admin');
const infakt = await import('@endora-commerce/mod-infakt/admin');

const DELIVERIES = 'tabs.deliveries';
const ROUTING = 'tabs.routing';
const INFAKT = 'tabs.connection';

const BUNDLE = {
  ...passthroughBundle('invoice_ledger', [DELIVERIES, ROUTING]),
  ...passthroughBundle('infakt', [INFAKT]),
};

const REGISTRY = [
  { moduleId: 'invoice_ledger', contributions: ledger.contributions },
  { moduleId: 'infakt', contributions: infakt.contributions },
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
          permissions: [...(options.permissions ?? ['invoice_ledger:read', 'infakt:read'])],
        }),
        presence: modulePresence({
          present: [...(options.present ?? ['invoice_ledger', 'infakt'])],
        }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('ledger.section.tabs — the contributions', () => {
  it('declares two ledger tabs and one Infakt tab, with no match', () => {
    const ledgerTabs = (ledger.contributions.zones ?? []).filter(
      (zone) => zone.zone === 'ledger.section.tabs',
    );
    expect(ledgerTabs).toHaveLength(2);
    for (const tab of ledgerTabs) {
      expect(tab.match).toBeUndefined();
      expect(tab.requiredPermission).toBe('invoice_ledger:read');
      expect(typeof tab.component).toBe('function');
    }

    const infaktTabs = (infakt.contributions.zones ?? []).filter(
      (zone) => zone.zone === 'ledger.section.tabs',
    );
    expect(infaktTabs).toHaveLength(1);
    expect(infaktTabs[0]!.match).toBeUndefined();
    expect(infaktTabs[0]!.requiredPermission).toBe('infakt:read');
  });

  it('orders deliveries, then routing, then Infakt', () => {
    const weights = (ledger.contributions.zones ?? [])
      .filter((zone) => zone.zone === 'ledger.section.tabs')
      .map((zone) => zone.weight);
    expect(weights[0]).toBeLessThan(weights[1]!);
    const infaktWeight = (infakt.contributions.zones ?? []).find(
      (zone) => zone.zone === 'ledger.section.tabs',
    )!.weight;
    expect(weights[1]!).toBeLessThan(infaktWeight);
  });

  it('keeps one Sales row on deliveries and none on Infakt', () => {
    expect(ledger.contributions.nav).toHaveLength(1);
    expect(ledger.contributions.nav?.[0]?.to).toBe('/invoice-ledger/deliveries');
    expect(infakt.contributions.nav ?? []).toHaveLength(0);
  });
});

describe('ledger.section.tabs — the strip', () => {
  it('offers all three routes when Infakt is on', async () => {
    const container = renderStrip({});
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(3));
    const hrefs = [...container.querySelector('[role="tablist"]')!.querySelectorAll('a')].map(
      (anchor) => anchor.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/invoice-ledger/deliveries', '/invoice-ledger/routing', '/infakt']);
  });

  it('keeps deliveries and routing when Infakt is off', async () => {
    const container = renderStrip({ present: ['invoice_ledger'] });
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
    expect(screen.queryByRole('tab', { name: INFAKT })).toBeNull();
  });

  it('marks the routing tab on the routing route', async () => {
    renderStrip({ path: '/invoice-ledger/routing' });
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    expect(screen.getByRole('tab', { name: ROUTING }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: DELIVERIES }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('hides Infakt without infakt:read', async () => {
    const container = renderStrip({ permissions: ['invoice_ledger:read'] });
    await waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(2));
  });
});

describe('ledger.section.tabs — every host mounts the place', () => {
  it('renders the member on deliveries, routing and Infakt screens', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const file of [
      '../packages/modules/invoice_ledger/src/admin/pages/LedgerDeliveriesPage.tsx',
      '../packages/modules/invoice_ledger/src/admin/pages/LedgerRoutingPage.tsx',
      '../packages/modules/infakt/src/admin/pages/InfaktConnectionPage.tsx',
    ]) {
      const host = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(host, file).toContain('name="ledger.section.tabs"');
    }
  });
});
