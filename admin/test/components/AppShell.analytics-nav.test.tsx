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
  'appShell.section.analyticsAds',
  'appShell.section.system',
  'appShell.nav.analytics',
  'appShell.nav.googleAnalytics',
  'appShell.nav.linkedinAds',
  'appShell.nav.metaAds',
  'appShell.nav.users',
]);

const { AppShell } = await import('../../src/components/AppShell');

/** The four entries the `Analytics & Ads` group owns, in sidebar order. */
const ANALYTICS_LINKS = [
  { href: '/analytics', labelKey: 'appShell.nav.analytics' },
  { href: '/google-analytics', labelKey: 'appShell.nav.googleAnalytics' },
  { href: '/linkedin-ads', labelKey: 'appShell.nav.linkedinAds' },
  { href: '/meta-ads', labelKey: 'appShell.nav.metaAds' },
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
