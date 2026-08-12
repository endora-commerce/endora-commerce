import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ModulePresence } from '@b2b/contracts';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

/**
 * Feature 073 / US1, FR-031 and FR-032 — the Admin UI resolves its surfaces
 * from the server's effective enabled-set.
 *
 * The driving case: an operator switches `pim_ergonode` off and it is gone from
 * the sidebar and from ⌘K. Two properties beyond that are worth pinning here,
 * because both were live defects before this feature:
 *
 *  - **A section with nothing left folds away.** The sidebar already did this
 *    for permissions; presence rides the same predicate rather than a second
 *    one that could disagree.
 *  - **The palette's hardcoded Navigate group is filtered.** The server-fed
 *    Actions group has been platform-axis aware since feature 020, but these 28
 *    frontend entries were gated by neither permission nor module state — that
 *    was the real leak, and a palette entry for an absent module is a link to a
 *    503.
 */

let presentModules = new Set<string>();

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

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [] as ModulePresence[],
    isPresent: (moduleId: string) => presentModules.has(moduleId),
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

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const coreBundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.search.placeholder',
  'appShell.search.openPalette',
  'appShell.search.shortcutSymbol',
  'appShell.section.catalog',
  'appShell.section.analyticsAds',
  'appShell.nav.pimErgonode',
  'appShell.nav.products',
  'appShell.nav.analytics',
  'appShell.nav.googleAnalytics',
  'appShell.nav.linkedinAds',
  'appShell.nav.metaAds',
  'appShell.nav.comparisons',
  'appShell.nav.home',
]);

const { AppShell } = await import('../../src/components/AppShell');

/** Everything the AppShell can render, minus the ids the caller switches off. */
const ALL_MODULES = [
  'orders', 'quick_order', 'returns', 'quote_requests', 'invoices', 'ksef',
  'catalog', 'assets_library', 'pim_ergonode', 'product_feeds', 'inventory',
  'price_lists', 'promotions', 'taxes', 'delivery_methods', 'payment_methods',
  'customers', 'organizations', 'credit_limits', 'comparisons',
  'sales_channels', 'dictionaries', 'seo', 'cms', 'megamenu', 'blog',
  'transactional_emails', 'newsletter', 'analytics', 'google_analytics',
  'linkedin_ads', 'meta_ads', 'admin_users', 'admin_roles', 'audit_logs',
  'api_keys', 'webhooks', 'credentials', 'import_export', 'settings', 'pwa',
  'custom_fields',
];

function renderShell(off: readonly string[] = []): void {
  presentModules = new Set(ALL_MODULES.filter((id) => !off.includes(id)));
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

function sidebarHrefs(): (string | null)[] {
  return [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
}

describe('AppShell — module presence drives the sidebar (FR-031)', () => {
  it('lists a present module', () => {
    renderShell();
    expect(sidebarHrefs()).toContain('/pim-ergonode');
  });

  it('drops a switched-off module and leaves its neighbours alone', () => {
    renderShell(['pim_ergonode']);
    const hrefs = sidebarHrefs();
    expect(hrefs).not.toContain('/pim-ergonode');
    // Same section, different module — the Catalog group survives.
    expect(hrefs).toContain('/catalog/products');
    expect(screen.queryByRole('button', { name: 'appShell.section.catalog' })).not.toBeNull();
  });

  it('folds a section away once every module in it is off', () => {
    renderShell(['analytics', 'google_analytics', 'linkedin_ads', 'meta_ads']);
    expect(
      screen.queryByRole('button', { name: 'appShell.section.analyticsAds' }),
      'a section whose every entry belongs to a switched-off module should not render',
    ).toBeNull();
  });

  it('keeps the dashboard, which belongs to no module', () => {
    renderShell(ALL_MODULES);
    expect(sidebarHrefs()).toContain('/');
  });

  it('keeps the platform Modules entry with every module switched off (D-36)', () => {
    // The screen that toggles modules belongs to no module, so it cannot be
    // toggled out of existence. With the control on the Settings screen — which
    // does belong to a module — switching that module off took away the entry
    // that led to the control that would switch it back on.
    renderShell(ALL_MODULES);
    expect(sidebarHrefs()).toContain('/platform/modules');
    expect(sidebarHrefs()).not.toContain('/settings');
  });
});

describe('AppShell — module presence drives the command palette (FR-032)', () => {
  /**
   * Scoped to the palette dialog on purpose: the same label also appears in the
   * sidebar, and a document-wide query would pass on the sidebar entry while
   * the palette leaked.
   */
  async function openPaletteItems(): Promise<string[]> {
    await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
    const dialog = await screen.findByRole('dialog');
    return [...dialog.querySelectorAll('.b2b-palette__item')].map(
      (el) => el.textContent ?? '',
    );
  }

  it('offers a present module in the Navigate group', async () => {
    renderShell();
    const items = await openPaletteItems();
    expect(items.some((text) => text.includes('appShell.nav.comparisons'))).toBe(true);
  });

  it('drops a switched-off module from the Navigate group', async () => {
    // `/comparisons` is one of the entries the palette advertised regardless of
    // module state before this feature.
    renderShell(['comparisons']);
    const items = await openPaletteItems();
    expect(items.some((text) => text.includes('appShell.nav.comparisons'))).toBe(false);
  });
});
