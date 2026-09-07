import { describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../helpers/render-with-session';

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



vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
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
  'appShell.nav.analytics',
  'appShell.nav.googleAnalytics',
  'appShell.nav.linkedinAds',
  'appShell.nav.metaAds',
  'appShell.nav.home',
  'appShell.palette.sub.dashboard',
]);

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

/**
 * Everything the AppShell can render, minus the ids the caller switches off.
 *
 * Derived from the shell's own `NAV` rather than listed here. The list this
 * replaced held 42 ids where the declarations hold 51, which is what a written
 * copy of a derived fact does: a module added to the sidebar was absent from
 * every case in this file and nothing said so — *"lists a present module"*
 * would have gone on passing about `pim_ergonode` while the new entry was
 * hidden in every one of them.
 */
const ALL_MODULES = everyDeclaredModule();

function renderShell(off: readonly string[] = []): void {
  presentModules = new Set(ALL_MODULES.filter((id) => !off.includes(id)));
  setMobileViewport(false);
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: [...presentModules] }) },
    ),
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

  it('offers the one hand-written Navigate row that is left', async () => {
    // The positive control. It named `/orders` until feature 091's Phase 4
    // batch 15 and `/comparisons` and `/credentials` before that; the dashboard
    // is what the group holds now, and it is the row that cannot move — see the
    // case below.
    renderShell();
    const items = await openPaletteItems();
    expect(items.some((text) => text.includes('appShell.nav.home'))).toBe(true);
  });

  it('leaves the hand-written Navigate group unchanged by presence, there being no module row left', async () => {
    // **The pair this replaces predicted its own end and is worth quoting**:
    // *"this file's subject is the hand-written Navigate group, so it needs an
    // entry that is still in it, and the pair has to move together: with the
    // subject gone the positive control goes red and this negative goes
    // **vacuously green**, which is the worse of the two."* Feature 091's Phase
    // 4 batch 15 moved `/orders` — the last module-owned row — into `orders`'
    // manifest, and the positive control went red exactly as that note said it
    // would. There is nowhere to re-point it: `PALETTE_ITEMS` now holds one row,
    // the dashboard, whose `module` is `null` by D-36's reasoning and which no
    // batch can drain.
    //
    // So the claim is re-derived rather than re-pointed. `isVisible` filters
    // this group, so the honest question is whether presence can change what it
    // yields — and with no module-owned row it cannot, which is asserted by
    // taking the group with **everything** present and with **nothing** present
    // and comparing. That is not a weaker statement: the day somebody adds a
    // module-owned row back to `PALETTE_ITEMS`, the two lists differ and this
    // case fails, which is the event that should re-instate the pair above it.
    //
    // FR-032's subject has moved to the server, where the Actions group is
    // resolved against the effective enabled-set — driven per batch in
    // `backend/test/integration/_admin_surfaces/batch-*-palette-off-state.test.ts`.
    renderShell();
    const withEverything = await openPaletteItems();
    cleanup();
    renderShell(ALL_MODULES);
    const withNothing = await openPaletteItems();
    expect(withNothing).toEqual(withEverything);
    expect(withEverything.filter((text) => text.includes('appShell.nav.home'))).toHaveLength(1);
    expect(withEverything).toHaveLength(1);
  });
});
