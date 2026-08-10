import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
  'appShell.brand.text',
  'appShell.section.catalog',
  'appShell.section.channels',
  'appShell.nav.productFeeds',
  'appShell.nav.feedTemplates',
  'appShell.nav.products',
]);

const { AppShell } = await import('../../src/components/AppShell');

function renderShell(): void {
  setMobileViewport(false);
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
}

function groupHrefs(labelKey: string): (string | null)[] {
  const heading = screen.getByRole('button', { name: labelKey });
  const group = heading.closest('.b2b-sidebar__group');
  expect(group).not.toBeNull();
  return [...(group as HTMLElement).querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

describe('AppShell — product feeds live under Catalog', () => {
  it('lists Product feeds in the Catalog group', () => {
    renderShell();
    expect(groupHrefs('appShell.section.catalog')).toContain('/product-feeds');
  });

  it('no longer lists Product feeds under Channels', () => {
    renderShell();
    expect(groupHrefs('appShell.section.channels')).not.toContain('/product-feeds');
  });

  it('drops the separate Feed templates entry from the sidebar entirely', () => {
    // Templates are reachable through the tab strip on the feeds page; a second
    // sidebar row for a sibling view is the duplication being removed here.
    renderShell();
    const allHrefs = [...document.querySelectorAll('.b2b-sidebar a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(allHrefs).not.toContain('/product-feeds/templates');
  });
});
