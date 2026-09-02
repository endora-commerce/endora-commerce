import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { OrderEntryTabs } from '../../src/components/OrderEntryTabs';


// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection names the ids this component asks about and nothing else; the
// filtering itself is covered in AppShell.module-presence.test.tsx.
//
// It is a **seeded provider**, not a stubbed hook, since feature 091's P3:
// `useModulePresence` is `@endora-commerce/admin-kit`'s, where a `vi.mock` on
// `@/lib/module-presence` cannot reach it. `withSession` supplies it through
// the `initial` prop it has carried since feature 073.

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
  'orderEntry.tab.standard',
  'orderEntry.tab.quick',
  'appShell.brand.text',
  'appShell.section.sales',
  'appShell.nav.newOrder',
  'appShell.nav.quickOrder',
  'appShell.nav.orders',
]);

/**
 * The two ids the component asks about, one per tab. Naming them rather than
 * seeding *"everything"* is what keeps the positive cases honest: the component
 * renders nothing at all when a tab's module is absent, and a projection that
 * silently omitted one would leave an empty frame this file could not tell
 * from a layout it was asserting.
 */
const PRESENT_MODULES = ['orders', 'quick_order'];

function renderTabs(path: string): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <OrderEntryTabs />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: PRESENT_MODULES }) },
    ),
    bundle,
  );
}

describe('OrderEntryTabs', () => {
  it('offers both order-entry routes', () => {
    renderTabs('/orders/new');
    const hrefs = [...screen.getByRole('tablist').querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/orders/new', '/orders/quick-order']);
  });

  it('marks the standard tab on the standard route', () => {
    renderTabs('/orders/new');
    expect(
      screen.getByRole('tab', { name: 'orderEntry.tab.standard' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'orderEntry.tab.quick' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('marks the quick tab on the quick route', () => {
    renderTabs('/orders/quick-order');
    expect(
      screen.getByRole('tab', { name: 'orderEntry.tab.quick' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('tab', { name: 'orderEntry.tab.standard' }).getAttribute('aria-selected'),
    ).toBe('false');
  });
});

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
        { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: PRESENT_MODULES }) },
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
