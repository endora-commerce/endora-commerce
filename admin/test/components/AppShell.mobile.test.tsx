import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

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

const coreBundle = passthroughBundle('core', [
  'appShell.mobileMenu.open',
  'appShell.mobileMenu.close',
  'appShell.brand.text',
  'appShell.nav.home',
  'appShell.search.openPalette',
  'appShell.profileMenu.signOut',
  'appShell.topbar.help',
]);

const { AppShell } = await import('../../src/components/AppShell');

describe('AppShell mobile', () => {
  it('opens and closes the navigation drawer', async () => {
    setMobileViewport(true);
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      coreBundle,
    );
    expect(document.querySelector('.b2b-sidebar--drawer-open')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'appShell.mobileMenu.open' }));
    expect(document.querySelector('.b2b-sidebar--drawer-open')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'appShell.mobileMenu.close' }));
    expect(document.querySelector('.b2b-sidebar--drawer-open')).toBeNull();
  });
});
