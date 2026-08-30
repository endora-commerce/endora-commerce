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

const coreBundle = {
  ...passthroughBundle('core', [
    'appShell.brand.text',
    'appShell.section.analyticsAds',
    'appShell.section.system',
    'appShell.nav.analytics',
    'appShell.nav.linkedinAds',
    'appShell.nav.metaAds',
    'appShell.nav.users',
  ]),
  // `google_analytics` owns its sidebar entry since feature 091's Phase 4, so
  // its label resolves in the **module's** namespace out of
  // `packages/modules/google_analytics/i18n/` — not in the shared `core`
  // bundle, whose `appShell.nav.googleAnalytics` entry is gone.
  ...passthroughBundle('google_analytics', ['nav.googleAnalytics.label']),
};

const { AppShell } = await import('../../src/components/AppShell');

/**
 * The four entries the `Analytics & Ads` group owns, in sidebar order.
 *
 * **`/google-analytics` is last, and that is the conversion rather than a
 * regression.** Its entry used to sit second, declared by hand in `NAV`; it now
 * arrives from `admin/src/modules.generated.ts`, and a module's entries append
 * to their section until the host's own entries carry weights — which
 * `AppShell.tsx`'s `composeNav` states in place and Story 3 delivers as it
 * drains them. The module already declares the weight that will restore the
 * position (200, `packages/modules/google_analytics/src/admin/index.ts`); there
 * is nothing yet to order it against.
 */
const ANALYTICS_LINKS = [
  { href: '/analytics', labelKey: 'appShell.nav.analytics' },
  { href: '/linkedin-ads', labelKey: 'appShell.nav.linkedinAds' },
  { href: '/meta-ads', labelKey: 'appShell.nav.metaAds' },
  { href: '/google-analytics', labelKey: 'nav.googleAnalytics.label' },
];

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

/** The `.b2b-sidebar__group` wrapper whose heading matches `labelKey`. */
function groupByLabel(labelKey: string): HTMLElement {
  const heading = screen.getByRole('button', { name: labelKey });
  const group = heading.closest('.b2b-sidebar__group');
  expect(group).not.toBeNull();
  return group as HTMLElement;
}

describe('AppShell — Analytics & Ads navigation group', () => {
  it('renders a dedicated section holding all four analytics entries', () => {
    renderShell();
    const group = groupByLabel('appShell.section.analyticsAds');
    const hrefs = [...group.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(ANALYTICS_LINKS.map((l) => l.href));
  });

  it('labels each entry from its own translation key', () => {
    renderShell();
    const group = groupByLabel('appShell.section.analyticsAds');
    for (const { labelKey } of ANALYTICS_LINKS) {
      expect(group.textContent).toContain(labelKey);
    }
  });

  it('no longer lists the analytics entries under System', () => {
    renderShell();
    const system = groupByLabel('appShell.section.system');
    const hrefs = [...system.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const { href } of ANALYTICS_LINKS) {
      expect(hrefs).not.toContain(href);
    }
  });

});
