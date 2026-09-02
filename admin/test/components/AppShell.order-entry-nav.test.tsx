import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Quick order has one sidebar row between it and standard order entry, and it
 * is not its own.
 *
 * The two entry modes are one destination reached two ways, so the sidebar
 * keeps *New order* and the switch between them lives on the page. This case
 * used to sit at the bottom of `OrderEntryTabs.test.tsx`, beside the strip it
 * is the counterpart of; feature 091's P4d turned that strip into the
 * `order.entry.tabs` zone and deleted the component, so the case moved here
 * rather than being deleted with it — it is about the **sidebar**, which the
 * conversion does not touch, and dropping it would have made this merge request
 * quietly stop asserting the half of the design that motivated the strip.
 *
 * The strip's own cases are
 * `admin/test/modules/orders/order-entry-tabs-zone.test.tsx`.
 */

vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const bundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.section.sales',
  'appShell.nav.newOrder',
  'appShell.nav.quickOrder',
  'appShell.nav.orders',
]);

/**
 * Both ids, named rather than seeded wholesale: a projection that omitted one
 * answers `isPresent` `false`, which is the gate's hidden branch, and the
 * assertion below would then pass for the wrong reason.
 */
const PRESENT_MODULES = ['orders', 'quick_order'];

const { AppShell } = await import('../../src/components/AppShell');

describe('AppShell — quick order leaves the sidebar', () => {
  it('keeps New order and drops Quick order', () => {
    setMobileViewport(false);
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<div>Home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['*'] }),
          presence: modulePresence({ present: PRESENT_MODULES }),
        },
      ),
      bundle,
    );
    const hrefs = [...document.querySelectorAll('.b2b-sidebar a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/orders/new');
    expect(hrefs).not.toContain('/orders/quick-order');
  });
});
