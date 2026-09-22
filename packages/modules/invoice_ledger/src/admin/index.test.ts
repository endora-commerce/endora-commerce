import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contributions } from './index.js';

/**
 * `invoice_ledger`'s admin **declaration**, and this package's own source
 * hygiene (feature 134 **W2.2**; **D-262** clause 3).
 *
 * Two of the four subjects of
 * `admin/test/modules/invoice_ledger/ledger-section-tabs-zone.test.tsx` are
 * this module's and live here: what it *declares* on the section strip, and
 * whether every screen the strip switches between actually mounts the strip.
 * Both are answerable with no jsdom, no RTL and no `admin/test/helpers/` —
 * none of which a package may name (`module-test-ownership.md` §3) — so they
 * run under this package's existing `environment: 'node'` config, here and in
 * whatever repository this package is installed into.
 *
 * What stays in the host file is the zone **mechanism** — ordering, presence,
 * permission, selected state and "a strip of one is not a choice" — because the
 * place is this module's and this module is staying. A vendor adapter's half of
 * the same strip is that package's own `src/admin/index.test.ts`, and travels
 * with it; this free package names no vendor, which is why the weight band
 * below is stated as this module's own fact rather than as a comparison.
 */

const SECTION_TABS = 'ledger.section.tabs';

function sectionTabs() {
  return (contributions.zones ?? []).filter((zone) => zone.zone === SECTION_TABS);
}

describe('invoice_ledger admin contributions', () => {
  it('contributes the historical remote id to invoice detail', () => {
    const zones = contributions.zones ?? [];
    expect(zones.some((entry) => entry.zone === 'invoice.detail.after')).toBe(true);
  });

  it('declares two section tabs, both unconditional and both on its read code', () => {
    const tabs = sectionTabs();
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      // No `match`: the two screens are always both reachable. A `match` here
      // would make the strip depend on props the host does not carry, which is
      // the fail-closed branch that hides a tab silently.
      expect(tab.match).toBeUndefined();
      expect(tab.requiredPermission).toBe('invoice_ledger:read');
      expect(typeof tab.component).toBe('function');
    }
  });

  it('orders deliveries before routing, and leaves room above for a vendor', () => {
    const weights = sectionTabs().map((tab) => tab.weight);
    expect(weights[0]).toBeLessThan(weights[1]!);
    // The band this module occupies, stated as its own fact: a vendor adapter's
    // connection tab is asked to weigh more than this, so that it sorts after
    // the screens it is a vendor *of*. This module names no vendor — the
    // agreement's other half is each vendor package's own test, and no single
    // file can state it once the vendors are installed rather than resolved
    // here.
    expect(Math.max(...weights.map((weight) => weight ?? 0))).toBeLessThanOrEqual(200);
  });

  it('keeps one Sales row, on deliveries', () => {
    expect(contributions.nav).toHaveLength(1);
    expect(contributions.nav?.[0]?.to).toBe('/invoice-ledger/deliveries');
    // Routing is a tab and not a second destination, which is the whole reason
    // the strip exists.
    expect((contributions.routes ?? []).map((route) => route.path)).toEqual([
      '/invoice-ledger/deliveries',
      '/invoice-ledger/routing',
    ]);
    for (const route of contributions.routes ?? []) {
      expect(route.requiredPermission).toBe('invoice_ledger:read');
    }
  });

  it('mounts the strip on every screen the strip switches between', () => {
    // A switch that is missing from one of the screens it switches between is
    // not a switch. `check:admin-zones` answers "does anything render this
    // zone" and is satisfied by one host, so this per-screen assertion is not
    // covered by it. Relative reads, because the package must answer this about
    // itself wherever it is installed.
    for (const page of ['./pages/LedgerDeliveriesPage.tsx', './pages/LedgerRoutingPage.tsx']) {
      const source = readFileSync(new URL(page, import.meta.url), 'utf8');
      expect(source, page).toContain(`name="${SECTION_TABS}"`);
    }
  });
});
