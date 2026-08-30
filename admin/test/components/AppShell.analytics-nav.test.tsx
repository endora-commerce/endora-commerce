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
    'appShell.nav.users',
  ]),
  // **All four labels resolve in a module's own namespace now**, out of
  // `packages/modules/<id>/i18n/`. `google_analytics` took its own in batch
  // one, `analytics` in batch two, and `linkedin_ads` and `meta_ads` in batch
  // three — with which the shared `core` bundle holds no `appShell.nav.*` key
  // for this section at all. That is the conversion visible in one place: the
  // `core` list above shrank by two entries in the same merge request the
  // sidebar stopped naming two modules.
  ...passthroughBundle('google_analytics', ['nav.googleAnalytics.label']),
  ...passthroughBundle('analytics', ['nav.analytics.label']),
  ...passthroughBundle('linkedin_ads', ['nav.linkedInAds.label']),
  ...passthroughBundle('meta_ads', ['nav.metaAds.label']),
};

const { AppShell } = await import('../../src/components/AppShell');

/**
 * The four entries the `Analytics & Ads` group owns, in sidebar order.
 *
 * **This is the order the hand-written table had, and getting it back is what
 * batch three delivered.** Batch one recorded that `/google-analytics` had
 * moved from second to last, because a module's entries append to their section
 * until the host's own carry weights; batch two recorded the same thing one
 * entry further on and restored the relative order of the two converted modules
 * by weight. With `linkedin_ads` and `meta_ads` converted, the section holds no
 * host-declared entry at all — `AppShell.tsx`'s `analyticsAds` block is
 * deliberately `items: []` — so `registryNavFor`'s `weight` is the whole of the
 * order, and the four declared weights (100, 200, 300, 400) reproduce exactly
 * what the hand-written table rendered.
 *
 * So this list is not merely updated: it is the evidence that an
 * operator-visible regression the two previous batches recorded is closed. If a
 * later batch reorders it again, that is a finding and not a fixture to edit.
 */
const ANALYTICS_LINKS = [
  { href: '/analytics', labelKey: 'nav.analytics.label' },
  { href: '/google-analytics', labelKey: 'nav.googleAnalytics.label' },
  { href: '/linkedin-ads', labelKey: 'nav.linkedInAds.label' },
  { href: '/meta-ads', labelKey: 'nav.metaAds.label' },
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

  it('renders the section entirely from the registry, with no host entry left', () => {
    // The property the order above rests on, asserted rather than inferred from
    // it. `AppShell.tsx` declares `analyticsAds` with `items: []`, so every
    // link in the group carries a `labelScope` — the field `composeNav` sets on
    // a registry entry and never on a host one. A host entry re-appearing here
    // would restore the append ordering and this file's first case would fail
    // for a reason its own list could not explain; this one names it.
    renderShell();
    const group = groupByLabel('appShell.section.analyticsAds');
    const labels = [...group.querySelectorAll('a')].map((a) => a.textContent ?? '');
    // A registry entry's label resolves in its module's namespace, so every one
    // of them reads as its module-relative key under `passthroughBundle`; a
    // host entry would read as an `appShell.nav.*` one.
    expect(labels.every((label) => !label.includes('appShell.nav.'))).toBe(true);
    expect(labels).toHaveLength(ANALYTICS_LINKS.length);
  });
});
