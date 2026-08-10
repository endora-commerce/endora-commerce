import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { OrderEntryTabs } from '../../src/components/OrderEntryTabs';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    me: {
      adminUser: {
        id: '1',
        email: 'admin@test.com',
        firstName: 'Ada',
        lastName: 'Min',
        preferredLanguage: 'en',
      },
      role: { name: 'Admin' },
    },
    logout: vi.fn(),
    hasPermission: () => true,
  }),
}));

// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection is stubbed as "everything is here"; the filtering itself is
// covered in AppShell.module-presence.test.tsx.
vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: () => true,
    presenceOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  setModuleActivation: vi.fn(),
  getModulePresence: vi.fn(),
}));

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

function renderTabs(path: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <OrderEntryTabs />
    </MemoryRouter>,
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
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      bundle,
    );
    const hrefs = [...document.querySelectorAll('.b2b-sidebar a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/orders/new');
    expect(hrefs).not.toContain('/orders/quick-order');
  });
});
