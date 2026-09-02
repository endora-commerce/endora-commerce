import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';

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

const coreBundle = {
  ...passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.search.placeholder',
  'appShell.search.openPalette',
  'appShell.search.shortcutSymbol',
  'appShell.section.customers',
  'appShell.section.sales',
  'appShell.nav.home',
  'appShell.nav.orders',
  'appShell.nav.organizations',
  'appShell.nav.priceLists',
  'appShell.nav.deliveryMethods',
  'appShell.nav.taxes',
  'appShell.section.inventory',
  'appShell.nav.stockOverview',
  'appShell.nav.warehouses',
  'appShell.nav.importStock',
  'appShell.section.pricing',
]),
  // `/payment-methods` is a **registry** entry since feature 091's Phase 4
  // batch 7 and `/credentials` since batch 10, so their labels resolve in the
  // owning modules' namespaces rather than in `core`. The cases below assert
  // the href, not the copy; the scopes are seeded so the rows render something
  // rather than a raw key.
  ...passthroughBundle('payment_methods', ['nav.paymentMethods.label']),
  ...passthroughBundle('credentials', ['nav.credentials.label']),
};

const { AppShell } = await import('../../src/components/AppShell');

function renderShell(granted: readonly string[]): void {
  grantedPermissions = new Set(granted);
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
      { session: adminSession({ permissions: [...grantedPermissions] }), presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
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
  it('hides the sidebar entry from a role without the code', () => {
    // `credentials:read` gates `/credentials`
    // (`packages/modules/credentials/src/backend/routes.ts`). The role below
    // holds a different code entirely.
    //
    // The subject was `/comparisons` until feature 091's Phase 4 drain moved
    // that module's sidebar row and palette entry into its own package, and it
    // was moved here for a reason this pair has now met itself: with
    // `comparisons` gone the positive control went red while the negative went
    // **vacuously green**.
    //
    // **`/credentials` converted in batch 10 and the palette half is gone
    // rather than re-pointed**, which is batch 7's decision for
    // `/payment-methods` arriving again. The row was a hand-written
    // `PALETTE_ITEMS` literal; the advertisement is the **server's** now, from
    // `credentials`' `open-credentials` manifest action resolved against the
    // effective enabled-set, which no admin-side test can see — its off-state
    // is driven in
    // `backend/test/integration/_admin_surfaces/batch-ten-palette-off-state.test.ts`.
    // Asserting a Navigate row that no longer exists would be a negative
    // passing for the wrong reason.
    //
    // Issue #230's palette half is still covered in this file by the `/orders`
    // case below, whose Navigate row is still hand-written. What this pair
    // measures now is what the `/payment-methods` pair measures: that the
    // **registry** entry's own `requiredPermission` is applied by
    // `isSurfaceVisible` rather than by a literal in this file.
    renderShell(['orders:read']);
    expect(sidebarHrefs()).not.toContain('/credentials');
  });

  it('shows the sidebar entry to a role holding the code', () => {
    renderShell(['credentials:read']);
    expect(sidebarHrefs()).toContain('/credentials');
  });

  it('gates /orders, which carried no code at all before this change', async () => {
    renderShell(['credentials:read']);
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
   * `payment_methods` took its own codes on 2026-08-28. A catalogue editor is
   * the role the old gate handed the screen to, which makes it the
   * discriminating negative rather than an arbitrary one.
   *
   * **What these two cases assert changed with feature 091's Phase 4 batch 7,
   * and the palette half is gone rather than re-pointed.** The sidebar entry was
   * a hand-written `NAV` literal and the Navigate row a hand-written
   * `PALETTE_ITEMS` literal; both are `@endora-commerce/mod-payment-methods`'
   * declarations now, and the palette advertisement is the **server's** — the
   * Actions group resolves the module's `open-payment-methods` manifest action
   * against the effective enabled-set, which no admin-side test can see. Its
   * off-state is driven in
   * `backend/test/integration/payment_methods/module-owned-surface-off-state.test.ts`.
   * Asserting a Navigate row that no longer exists would have been a negative
   * passing for the wrong reason and a positive going red, which is what
   * happened when this batch first ran.
   *
   * The sidebar pair stays and now measures something it could not before: that
   * the **registry** entry's `requiredPermission` is the module's own read code,
   * applied by `isSurfaceVisible` rather than by a literal in this file. Issue
   * #230's palette half is covered here by the `/orders` case above, whose
   * Navigate row is still hand-written; the `delivery_methods` pair below this
   * paragraph once carried it and converted in batch 8.
   */
  it('hides /payment-methods from a catalogue editor', () => {
    renderShell(['catalog:read', 'catalog:write']);
    expect(sidebarHrefs()).not.toContain('/payment-methods');
  });

  it('shows /payment-methods to a role holding payment_methods:read', () => {
    renderShell(['payment_methods:read']);
    expect(sidebarHrefs()).toContain('/payment-methods');
    // …and only that one. The two method screens sit next to each other and
    // used to carry one code between them, so the discriminating assertion is
    // that the neighbour stays hidden. One render per case on purpose:
    // `renderShell` mounts a second shell beside the first rather than
    // replacing it, so a `not.toContain` after two renders reads both.
    expect(sidebarHrefs()).not.toContain('/delivery-methods');
  });

  /**
   * `delivery_methods` took its own codes on 2026-08-28, on the same terms and
   * for the same reason.
   *
   * **The palette half of this pair is gone since feature 091's batch 8**, and
   * its absence is the point rather than a loss of coverage. The row was a
   * `PALETTE_ITEMS` literal in `AppShell.tsx` — a copy of an advertisement the
   * server was never asked about, which went on offering the screen after an
   * operator switched the module off. It is a manifest action now
   * (`open-delivery-methods`), so the surface the operator sees is the one the
   * effective enabled-set filters, and it is proved where that filtering
   * happens:
   * `backend/test/integration/_admin_surfaces/batch-eight-palette-off-state.test.ts`.
   * Asserting `false` here would still pass — for the wrong reason, nothing
   * renders the row at all — which is exactly the shape this suite refuses.
   */
  it('hides /delivery-methods from a catalogue editor', () => {
    renderShell(['catalog:read', 'catalog:write']);
    expect(sidebarHrefs()).not.toContain('/delivery-methods');
  });

  it('shows /delivery-methods to a role holding delivery_methods:read', () => {
    renderShell(['delivery_methods:read']);
    expect(sidebarHrefs()).toContain('/delivery-methods');
    expect(sidebarHrefs()).not.toContain('/payment-methods');
  });

  /**
   * `taxes` took its own codes on 2026-08-28, the last of the four the sweep in
   * `specs/080-f4-real-scope/payments-permission-ownership.md` §7.2 classified
   * as defective — and the only one whose sidebar entry carried a **write**
   * code, because every one of its four routes did.
   *
   * So the negative here is not the catalogue *reader* the three predecessors
   * used: `catalog:read` never opened this screen. It is the catalogue
   * **editor**, which did, and which now must not.
   *
   * The sidebar is asserted alone because there is nothing else to assert:
   * `taxes` contributes no `PALETTE_ITEMS` Navigate row and no manifest action,
   * so the ⌘K palette has never offered this screen at all. That is a
   * Principle XVI gap and it is reported rather than repaired here — adding a
   * discovery surface is not this merge request's subject, and a palette row
   * added now would carry the code without ever having carried the wrong one.
   */
  it('hides /taxes from a catalogue editor', () => {
    renderShell(['catalog:read', 'catalog:write']);
    expect(sidebarHrefs()).not.toContain('/taxes');
  });

  it('shows /taxes to a role holding taxes:read', () => {
    renderShell(['taxes:read']);
    expect(sidebarHrefs()).toContain('/taxes');
    // The read half alone opens the screen; the write half is what the screen's
    // own editing affordances are gated on, not its entry.
  });

  /**
   * `inventory` took its own codes on 2026-08-29 — the largest of the set, 21
   * routes, and the only one that borrowed **two** modules' codes on two halves
   * of one surface. So there are two negatives here rather than one, and they
   * are different roles: an orders reader, who could enumerate every warehouse
   * and its address, and a catalogue editor, who could delete one.
   *
   * The read entries and the import entry are asserted separately because they
   * moved to different codes: four to `inventory:read` and the importer to
   * `inventory:write`, which is what its old `catalog:write` was for.
   */
  it('hides every inventory entry from an orders reader', async () => {
    renderShell(['orders:read']);
    const hrefs = sidebarHrefs();
    expect(hrefs).not.toContain('/inventory');
    expect(hrefs).not.toContain('/warehouses');
    expect(hrefs).not.toContain('/inventory/low-stock');
    expect(hrefs).not.toContain('/inventory/notifications');
    expect(hrefs).not.toContain('/inventory/import');
    // The palette half of this claim left the admin in feature 091's Phase 4
    // batch 13: `inventory`'s hand-written `PALETTE_ITEMS` row was a second
    // copy of the `open-inventory` action its manifest already declared, so it
    // is gone and the surviving advertisement is the server's, resolved from
    // the manifest against the effective enabled-set. It is driven in
    // `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // What stays here is the sidebar, which is this file's subject.
  });

  it('hides every inventory entry from a catalogue editor', () => {
    renderShell(['catalog:read', 'catalog:write']);
    const hrefs = sidebarHrefs();
    expect(hrefs).not.toContain('/inventory');
    expect(hrefs).not.toContain('/warehouses');
    expect(hrefs).not.toContain('/inventory/import');
  });

  it('shows the inventory reads to a role holding inventory:read, and not the importer', () => {
    renderShell(['inventory:read']);
    const hrefs = sidebarHrefs();
    expect(hrefs).toContain('/inventory');
    expect(hrefs).toContain('/warehouses');
    expect(hrefs).toContain('/inventory/low-stock');
    expect(hrefs).toContain('/inventory/notifications');
    // The import screen is a write and says so.
    expect(hrefs).not.toContain('/inventory/import');
  });

  it('shows the importer to a role holding inventory:write', () => {
    renderShell(['inventory:read', 'inventory:write']);
    expect(sidebarHrefs()).toContain('/inventory/import');
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
    expect(hrefs).toContain('/price-lists');
    // `/price-lists`' palette row went the other of batch 13's two ways:
    // `price_lists` declared no action at all, so `open-price-lists` arrives in
    // its manifest carrying this row's destination, code and keywords, and the
    // advertisement is the server's. The sidebar entry above is the half this
    // file can see; the other is
    // `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    expect((await openPaletteItems()).some((t) => t.includes('appShell.nav.home'))).toBe(true);
  });
});
