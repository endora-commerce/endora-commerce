import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ModulePresence } from '@endora-commerce/contracts';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';

/**
 * Issue #230 — the permission half of the palette leak.
 *
 * Feature 073 closed the module-state half: a switched-off module contributes
 * no sidebar row and no ⌘K row. The permission half survived it, because
 * `PaletteItem` had no `requiredPermission` field at all — not unset, absent
 * from the interface — so the 28 static Navigate entries could not have been
 * gated by any amount of data. An operator whose modules were all present still
 * saw palette entries for screens their role cannot open, which Principle XVI
 * item 2 forbids in as many words.
 *
 * The property pinned here is the one the issue asks for and the one that keeps
 * the two surfaces from drifting apart again: **a role without the code sees
 * neither the nav entry nor the palette entry; with it, both appear.** Both
 * assertions run against the same render, so a fix to one surface that misses
 * the other fails.
 */

let grantedPermissions = new Set<string>();

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
    hasPermission: (code: string) =>
      grantedPermissions.has('*') || grantedPermissions.has(code),
  }),
}));

vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [] as ModulePresence[],
    // Every module present, on purpose: this file is about the axis that
    // survives *after* presence has done its job.
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
  'appShell.section.customers',
  'appShell.section.sales',
  'appShell.nav.home',
  'appShell.nav.orders',
  'appShell.nav.comparisons',
  'appShell.nav.organizations',
  'appShell.nav.priceLists',
  'appShell.nav.paymentMethods',
]);

const { AppShell } = await import('../../src/components/AppShell');

function renderShell(granted: readonly string[]): void {
  grantedPermissions = new Set(granted);
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

/**
 * Scoped to the palette dialog on purpose: every one of these labels also
 * appears in the sidebar, and a document-wide query would pass on the sidebar
 * row while the palette leaked — which is exactly the defect under test.
 */
async function openPaletteItems(): Promise<string[]> {
  await userEvent.click(screen.getByPlaceholderText('appShell.search.placeholder'));
  const dialog = await screen.findByRole('dialog');
  return [...dialog.querySelectorAll('.b2b-palette__item')].map((el) => el.textContent ?? '');
}

describe('AppShell — permission gates the palette and the sidebar alike (issue #230)', () => {
  it('hides both surfaces from a role without the code', async () => {
    // `comparisons:read` gates `/comparisons`
    // (`backend/src/modules/comparisons/routes.admin.ts:37`). The role below
    // holds a different code entirely.
    renderShell(['orders:read']);
    expect(sidebarHrefs()).not.toContain('/comparisons');
    const items = await openPaletteItems();
    expect(items.some((text) => text.includes('appShell.nav.comparisons'))).toBe(false);
  });

  it('shows both surfaces to a role holding the code', async () => {
    renderShell(['comparisons:read']);
    expect(sidebarHrefs()).toContain('/comparisons');
    const items = await openPaletteItems();
    expect(items.some((text) => text.includes('appShell.nav.comparisons'))).toBe(true);
  });

  it('gates /orders, which carried no code at all before this change', async () => {
    renderShell(['comparisons:read']);
    expect(sidebarHrefs()).not.toContain('/orders');
    expect((await openPaletteItems()).some((t) => t.includes('appShell.nav.orders'))).toBe(false);

    renderShell(['orders:read']);
    expect(sidebarHrefs()).toContain('/orders');
  });

  it('accepts either code of an any-of route gate', () => {
    // `/api/v1/admin/organizations` is `requireAdminAny(['customers:read',
    // 'customers:manage'])`. Naming only the first hid the screen from a role
    // holding just the second.
    renderShell(['customers:manage']);
    expect(sidebarHrefs()).toContain('/organizations');

    renderShell(['customers:read']);
    expect(sidebarHrefs()).toContain('/organizations');
  });

  /**
   * `payment_methods` took its own codes on 2026-08-28. The sidebar entry and
   * the Navigate row are two literals nothing derives — `check:action-route-
   * permissions` reads the manifest action and the backend route and no file in
   * this application — so the code they carry is checked here or nowhere. A
   * catalogue editor is the role the old gate handed the screen to, which makes
   * it the discriminating negative rather than an arbitrary one.
   */
  it('hides /payment-methods from a catalogue editor', async () => {
    renderShell(['catalog:read', 'catalog:write']);
    expect(sidebarHrefs()).not.toContain('/payment-methods');
    expect(
      (await openPaletteItems()).some((t) => t.includes('appShell.nav.paymentMethods')),
    ).toBe(false);
  });

  it('shows /payment-methods to a role holding payment_methods:read', async () => {
    renderShell(['payment_methods:read']);
    expect(sidebarHrefs()).toContain('/payment-methods');
    expect(
      (await openPaletteItems()).some((t) => t.includes('appShell.nav.paymentMethods')),
    ).toBe(true);
  });

  it('leaves an ungated shell surface alone', async () => {
    // The dashboard belongs to no module and has no permission code; a role
    // holding nothing at all still reaches it.
    renderShell([]);
    expect(sidebarHrefs()).toContain('/');
    expect((await openPaletteItems()).some((t) => t.includes('appShell.nav.home'))).toBe(true);
  });

  it('folds a section away when every entry in it is denied', () => {
    renderShell([]);
    expect(
      screen.queryByRole('button', { name: 'appShell.section.customers' }),
      'a section whose every entry is permission-denied should not render',
    ).toBeNull();
  });

  it('keeps the wildcard role seeing everything', async () => {
    renderShell(['*']);
    const hrefs = sidebarHrefs();
    expect(hrefs).toContain('/orders');
    expect(hrefs).toContain('/comparisons');
    expect(hrefs).toContain('/organizations');
    expect((await openPaletteItems()).some((t) => t.includes('appShell.nav.priceLists'))).toBe(true);
  });
});
